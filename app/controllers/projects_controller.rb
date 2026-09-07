class ProjectsController < ApplicationController
  before_action :set_project, only: %i[ show update destroy ]

  def index
    # "My Comics" is the root — projects filed into a folder are found via
    # that folder (FoldersController#show) instead of cluttering this list.
    @projects = Current.user.projects.where(folder_id: nil).includes(:pages).order(updated_at: :desc)
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
      params.require(:project).permit(:name, :folder_id)
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
    def save_project
      if @project.update(project_params)
        redirect_to project_path(@project), notice: "Saved."
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
        folder_id: project_params[:folder_id]
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
