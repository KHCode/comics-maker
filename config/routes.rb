Rails.application.routes.draw do
  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  # Render dynamic PWA files from app/views/pwa/* (remember to link manifest in application.html.erb)
  # get "manifest" => "rails/pwa#manifest", as: :pwa_manifest
  # get "service-worker" => "rails/pwa#service_worker", as: :pwa_service_worker

  resource :session, only: %i[ new create destroy ]
  resources :users, only: %i[ new create ]
  resources :projects, only: %i[ index show update create destroy ] do
    resources :pages, only: %i[ create update destroy ] do
      member do
        patch :grow
        patch :shrink
      end
    end
  end
  # index/show were dropped when folders became tabs on the Projects
  # screen itself (see ProjectsController#index) — every folder and its
  # contents are now viewable from the root page, so there's no separate
  # page for them to route to anymore. create is unchanged (inline folder
  # creation from the Save dialog).
  resources :folders, only: %i[ create ]

  # Defines the root path route ("/")
  root "projects#index"
end
