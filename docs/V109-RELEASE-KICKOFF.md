# One-time v1.0.9 release kickoff

The v1.0.9 code and all mandatory PR gates were already merged to `main`. This PR triggers the guarded `.github/workflows/v109-release-kickoff.yml` workflow: it verifies the trusted commit ancestry, creates a Git tag, and dispatches `build-exe.yml` for the tag. It must never merge unreviewed source or bypass tests.

Do not treat this PR as proof of publication. Verify the actual GitHub Release and the SHA256 of the downloadable Windows installer.

Re-run requested after full-history checkout fix in one-time release workflow.
