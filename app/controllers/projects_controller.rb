class ProjectsController < ApplicationController
  before_action :set_project, only: %i[ show destroy ]

  def index
    @projects = Current.user.projects.includes(:pages).order(updated_at: :desc)
  end

  def show
    @pages = @project.pages
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
end
