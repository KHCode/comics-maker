class PagesController < ApplicationController
  before_action :set_project
  before_action :set_page, only: %i[ update destroy grow shrink ]

  def create
    if @project.webtoon?
      return redirect_to project_path(@project), alert: "Webtoon comics use one continuous page."
    end

    pages_before = @project.pages.to_a
    next_position = pages_before.map(&:position).max.to_i + 1
    page = @project.pages.create!(position: next_position, name: "Page #{next_position}")

    respond_to do |format|
      # A plain redirect (like every other action here) would reload the
      # whole editor — wiping every unsaved, session-only view setting
      # (zoom, Columns, Hide text, undo history…) for no reason a mere
      # page *addition* should. Appending just the new page's own markup
      # leaves the rest of the DOM (and every other page's already-
      # connected document-store/panel/text controllers) untouched.
      format.turbo_stream do
        streams = []
        # The first page's "Delete page" button stays hidden while it's
        # the only page (see the partial) — once this add makes it no
        # longer the only page, that page needs re-rendering too so its
        # button appears without waiting for a future full reload. This
        # has to run *before* the append below: editor_controller.js's
        # pageTargetConnected marks whichever page connects last as the
        # active one, and the just-added page (not page 1) needs to win
        # that race.
        if pages_before.one?
          streams << turbo_stream.replace(helpers.dom_id(pages_before.first), partial: "projects/page", locals: { page: pages_before.first, project: @project, page_count: @project.pages.count })
        end
        streams << turbo_stream.append("pages", partial: "projects/page", locals: { page: page, project: @project, page_count: @project.pages.count })
        render turbo_stream: streams
      end
      format.html { redirect_to project_path(@project), notice: "#{page.name} added." }
    end
  end

  # The single write path for a page's editing content (panels/texts) —
  # every future mode (Layout/Draw/Letter) saves through this endpoint via
  # the client-side document store, not through mode-specific endpoints.
  def update
    # panels/texts are heterogeneous, client-authored JSON (see the doc's
    # panel{}/text{} schema) with no fixed key set, so field-by-field
    # strong-param permitting doesn't apply here. This is safe because we
    # only ever pull out these two keys and re-wrap them ourselves into
    # `data` below — nothing here gets mass-assigned onto the model.
    page_params = params.require(:page).to_unsafe_h

    @page.update!(data: {
      "schema_version" => @page.data.fetch("schema_version", 1),
      "panels" => page_params["panels"].is_a?(Array) ? page_params["panels"] : [],
      "texts" => page_params["texts"].is_a?(Array) ? page_params["texts"] : []
    })

    attach_new_photos(page_params["photo_signed_ids"])

    head :no_content
  end

  def destroy
    if @project.pages.count <= 1
      return redirect_to project_path(@project), alert: "A comic needs at least one page."
    end

    renumbered_pages = []
    ActiveRecord::Base.transaction do
      deleted_position = @page.position
      @page.destroy!
      renumbered_pages = @project.pages.where("position > ?", deleted_position).order(:position).to_a
      renumbered_pages.each do |page|
        new_position = page.position - 1
        # Only renumber the label if it still matches the auto-generated
        # default — once pages can be renamed (a later PR), a custom name
        # should survive earlier pages being deleted.
        new_name = page.name == "Page #{page.position}" ? "Page #{new_position}" : page.name
        page.update!(position: new_position, name: new_name)
      end
    end

    respond_to do |format|
      # Same reasoning as #create's turbo_stream branch: a plain redirect
      # would reload the whole editor for no reason a page *removal*
      # should either.
      format.turbo_stream do
        remaining_count = @project.pages.count
        streams = [ turbo_stream.remove(helpers.dom_id(@page)) ]
        # Every page after the deleted one shifted position (and maybe
        # name) above — those need re-rendering so their label reflects
        # the new numbering immediately rather than after some future
        # reload.
        pages_to_refresh = renumbered_pages
        # Down to one page left: that lone page's own "Delete page"
        # button needs to disappear too (see the partial), even when its
        # own position never changed — e.g. deleting page 2 of 2 leaves
        # page 1 untouched by the renumbering above, but it still isn't
        # deletable any more.
        pages_to_refresh = @project.pages.to_a if remaining_count == 1 && pages_to_refresh.empty?
        pages_to_refresh.each do |page|
          streams << turbo_stream.replace(helpers.dom_id(page), partial: "projects/page", locals: { page: page, project: @project, page_count: remaining_count })
        end
        render turbo_stream: streams
      end
      format.html { redirect_to project_path(@project), notice: "#{@page.name} deleted.", status: :see_other }
    end
  end

  def grow
    return head :unprocessable_entity unless @project.webtoon?

    @page.update!(height_units: @page.height_units.to_i + 1)
    redirect_to project_path(@project)
  end

  def shrink
    return head :unprocessable_entity unless @project.webtoon?

    if @page.height_units.to_i <= 1
      return redirect_to project_path(@project), alert: "Already at the shortest height."
    end

    @page.update!(height_units: @page.height_units - 1)
    redirect_to project_path(@project)
  end

  private
    def set_project
      @project = Current.user.projects.find(params[:project_id])
    end

    def set_page
      @page = @project.pages.find(params[:id])
    end

    # Panels reference an uploaded photo by its blob's signed_id (see the
    # doc's panel.photo schema), not a foreign key — but the blob still
    # needs a real owner so it's destroyed along with the page instead of
    # orphaned forever (see Page#photos). Every save resends the full set
    # of signed_ids currently referenced in `data`, so only ones not
    # already attached actually get attached here.
    def attach_new_photos(signed_ids)
      return unless signed_ids.is_a?(Array)

      blobs = signed_ids.filter_map { |signed_id| ActiveStorage::Blob.find_signed(signed_id) }
      # page.photos (has_many_attached) yields Attachment records, not
      # Blobs — comparing against their own #id would never match a
      # blob's id, silently defeating this whole dedup check.
      already_attached_blob_ids = @page.photos_attachments.pluck(:blob_id)
      new_blobs = blobs.reject { |blob| already_attached_blob_ids.include?(blob.id) }
      @page.photos.attach(new_blobs) if new_blobs.any?
    end
end
