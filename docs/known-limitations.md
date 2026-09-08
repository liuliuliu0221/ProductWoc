# Known limitations

- ProductWoc is pre-release and optimized for a single local user and workspace.
- Durable storage is atomic local JSON, not a multi-user or distributed database.
- The deterministic provider is for offline development and acceptance testing;
  the current Planning Web does not yet generate production-quality plans and the
  current Development flow does not generate production-quality code for
  arbitrary requests.
- Stage 4 external model endpoints are configured by the developer/operator, not
  by browser users, and may differ in capabilities, latency, token use and cost.
  Required CI never calls them.
- P4-01 loads and validates operator configuration, resolves environment
  references, generates a configuration Hash and blocks new Web generation when
  configuration is unavailable. `models test` does not contact an Endpoint until
  P4-02, and Planning continues to use explicitly labelled deterministic test
  generation until the P4-03 real Planning chain is complete.
- Automatic Git commits, Git Push, package publishing, deployment and production
  writes are intentionally unavailable.
- Dependency installation requires explicit user confirmation and remains subject
  to package-manager lifecycle-script risk.
- Windows policy behavior is covered by portable path fixtures; the current CI
  workflow executes on Linux until a Windows runner is added.
- Public vulnerability reporting depends on the repository owner enabling GitHub
  private vulnerability reporting after repository creation.
- ProductFac compatibility data is inert and is not a runtime dependency.
