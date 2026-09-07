class FoldersController < ApplicationController
  def index
    @folders = Current.user.folders.order(:name)
  end

  def show
    @folder = Current.user.folders.find(params[:id])
    @projects = @folder.projects.includes(:pages).order(updated_at: :desc)
  end

  # Used inline from the Save dialog ("create folders inline" per the doc).
  # When project_id is present (i.e. created from within a project's Save
  # dialog), we return to that project with the dialog reopened rather than
  # a generic page — built from an owned project id, not a raw redirect
  # target, so this can't be used as an open redirect.
  def create
    folder = Current.user.folders.new(folder_params)
    destination = save_dialog_destination || projects_path

    if folder.save
      redirect_to destination, notice: "#{folder.name} created."
    else
      redirect_to destination, alert: folder.errors.full_messages.to_sentence
    end
  end

  private
    def folder_params
      params.require(:folder).permit(:name)
    end

    def save_dialog_destination
      return nil if params[:project_id].blank?

      project = Current.user.projects.find(params[:project_id])
      project_path(project, open_save: true)
    end
end
