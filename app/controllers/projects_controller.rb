class ProjectsController < ApplicationController
  before_action :set_project, only: %i[ show update destroy ]

  def index
    # "My Comics" is the default tab — every folder gets its own tab
    # alongside it (see projects/index.html.erb's project-tabs), all
    # rendered here so switching between them never leaves this page.
    @projects = Current.user.projects.where(folder_id: nil).includes(:pages).order(updated_at: :desc)
    @folders = Current.user.folders.includes(projects: :pages).order(:name)
  end

  def show
    load_editor_locals
    # Set after redirecting back from creating a folder inline (see
    # FoldersController#create) so the Save dialog reopens automatically
    # instead of the user landing on a closed dialog.
    @open_save_dialog = params[:open_save].present?
  end

  # The Save dialog is a single form with two submit buttons ("Save" and
  # "Save As…", distinguished by `save_mode`) rather than two separate
  # forms — see the "Save"/"Save As" buttons in projects/_save_dialog.
  def update
    if params[:save_mode] == "save_as"
      duplicate_project
    else
      save_project
    end
  end

  def create
    unless Project.formats.key?(params[:format])
      return redirect_to projects_path, alert: "Choose a valid comic format."
    end

    project = Current.user.projects.new(
      name: "Comic ##{Current.user.projects.count + 1}",
      format: params[:format]
    )
    project.pages.build(
      position: 1,
      name: "Page 1",
      height_units: project.webtoon? ? 1 : nil
    )

    if project.save
      redirect_to project_path(project), notice: "#{project.name} created."
    else
      redirect_to projects_path, alert: project.errors.full_messages.to_sentence
    end
  end

  def destroy
    @project.destroy
    redirect_to projects_path, notice: "#{@project.name} deleted.", status: :see_other
  end

  private
    def set_project
      @project = Current.user.projects.find(params[:id])
    end

    def project_params
      permitted = params.require(:project).permit(:name, :folder_id, :thumbnail)
      # An absent/failed client-side thumbnail render (see save_dialog_
      # controller.js) leaves the hidden field blank rather than omitted —
      # assigning that blank string as a signed_id would blow up trying to
      # resolve it, and would otherwise silently wipe out a thumbnail from
      # a previous successful save.
      permitted.delete(:thumbnail) if permitted[:thumbnail].blank?
      permitted
    end

    # Inline rename (see projects/_project.html.erb) submits from wherever
    # the project list is currently being viewed (My Comics or a folder)
    # and should return there, not into the full editor — unlike the Save
    # dialog's own submit, which has no return_to and keeps its existing
    # "back to the editor" redirect. Only a same-origin relative path is
    # ever honored (never "//host/..." or an absolute URL), the same
    # trusted-redirect-target discipline as FoldersController#create's own
    # save_dialog_destination.
    def safe_return_to
      candidate = params[:return_to]
      candidate if candidate.present? && candidate.start_with?("/") && !candidate.start_with?("//")
    end

    def load_editor_locals
      @pages = @project.pages
      @folders = Current.user.folders.order(:name)
      @folder_projects = Current.user.projects
        .where(folder_id: @project.folder_id)
        .where.not(id: @project.id)
        .order(:name)
    end

    # "Save" — renames the project and/or moves it to a different folder.
    # Also doubles as the inline-rename form on the project list (see
    # projects/_project.html.erb), which only ever sets :name and always
    # carries a return_to — a validation failure there should bounce back
    # to that list with an alert, not into the (unrelated, and for that
    # request possibly not even loaded) editor Save-dialog error view.
    def save_project
      if @project.update(project_params)
        redirect_to safe_return_to || project_path(@project), notice: "Saved."
      elsif safe_return_to
        redirect_to safe_return_to, alert: @project.errors.full_messages.to_sentence
      else
        load_editor_locals
        @open_save_dialog = true
        render :show, status: :unprocessable_entity
      end
    end

    # "Save As…" — writes a new copy (project + all its pages); the
    # original is left untouched.
    def duplicate_project
      new_project = Current.user.projects.new(
        name: project_params[:name].presence || "Copy of #{@project.name}",
        format: @project.format,
        folder_id: project_params[:folder_id],
        thumbnail: project_params[:thumbnail]
      )

      if new_project.save
        @project.pages.order(:position).each do |page|
          new_project.pages.create!(
            position: page.position,
            name: page.name,
            height_units: page.height_units,
            data: page.data
          )
        end
        redirect_to project_path(new_project), notice: "Saved a copy as \"#{new_project.name}\"."
      else
        load_editor_locals
        @open_save_dialog = true
        flash.now[:alert] = new_project.errors.full_messages.to_sentence
        render :show, status: :unprocessable_entity
      end
    end
end
