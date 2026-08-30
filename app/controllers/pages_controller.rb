class PagesController < ApplicationController
  before_action :set_project
  before_action :set_page, only: %i[ update destroy grow shrink ]

  def create
    if @project.webtoon?
      return redirect_to project_path(@project), alert: "Webtoon comics use one continuous page."
    end

    next_position = @project.pages.maximum(:position).to_i + 1
    page = @project.pages.create!(position: next_position, name: "Page #{next_position}")
    redirect_to project_path(@project), notice: "#{page.name} added."
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

    head :no_content
  end

  def destroy
    if @project.pages.count <= 1
      return redirect_to project_path(@project), alert: "A comic needs at least one page."
    end

    ActiveRecord::Base.transaction do
      deleted_position = @page.position
      @page.destroy!
      @project.pages.where("position > ?", deleted_position).order(:position).each do |page|
        new_position = page.position - 1
        # Only renumber the label if it still matches the auto-generated
        # default — once pages can be renamed (a later PR), a custom name
        # should survive earlier pages being deleted.
        new_name = page.name == "Page #{page.position}" ? "Page #{new_position}" : page.name
        page.update!(position: new_position, name: new_name)
      end
    end

    redirect_to project_path(@project), notice: "#{@page.name} deleted.", status: :see_other
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
end
