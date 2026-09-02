# Known limitations

- ProductWoc is pre-release and optimized for a single local user and workspace.
- Durable storage is atomic local JSON, not a multi-user or distributed database.
- The deterministic provider is for offline development and acceptance testing;
  it does not generate production-quality code for arbitrary requests.
- External model endpoints are user configured and may differ in capabilities,
  latency, token use and cost. Required CI never calls them.
- Automatic Git commits, Git Push, package publishing, deployment and production
  writes are intentionally unavailable.
- Dependency installation requires explicit user confirmation and remains subject
  to package-manager lifecycle-script risk.
- Windows policy behavior is covered by portable path fixtures; the current CI
  workflow executes on Linux until a Windows runner is added.
- Public vulnerability reporting depends on the repository owner enabling GitHub
  private vulnerability reporting after repository creation.
- ProductFac compatibility data is inert and is not a runtime dependency.
