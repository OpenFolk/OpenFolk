# Contributing to OpenFolk

Thank you for taking the time to contribute.

## Before you start

- **Bugs and ideas** go into the issue tracker. Please use the templates; they ask for the details we need to
  reproduce or evaluate.
- **Security issues** must not be reported publicly. See the [security policy](SECURITY.md).
- **Bigger changes** (new features, architectural changes) start with an issue so we can agree on the approach
  before you invest time.

## License

OpenFolk is released under the [MIT License](LICENSE). By opening a pull request you agree that your contribution
is licensed under the same terms. You keep the copyright of your contribution; no separate agreement is needed.

## Pull requests

1. Fork the repository and create a branch from `main`. Read `AGENTS.md` first: it names the rules this project
   does not bend and the surfaces every change has to cover (browser, desktop and mobile apps; the engines;
   several machines; both languages).
2. **One problem per pull request.** A pull request that solves two independent problems is split, even when
   both fixes are good. Include everything that one problem needs: protocol, backend, web app, tests, docs.
   An adjacent cleanup gets its own pull request.
3. Follow the existing style of the code you touch: same naming, same comment density, same idioms. Code,
   comments and commit messages are English; user-facing texts go into the i18n dictionaries in both languages
   (`webapp/i18n/en.js` and `de.js`, `local/src/i18n.ts`).
4. Add or update tests and make sure `npm run typecheck`, `npm run lint` and `npm test` pass.
5. **Show the evidence.** Describe in the pull request *what* changes and *why*, how you reproduced the problem,
   which checks you ran and what they printed, and what you could not check. "Tests pass" alone does not show
   that the change works. UI changes need before-and-after screenshots; anything with motion or timing a short
   recording. Link the related issue.

## Commit messages

Use the imperative mood in the subject line ("Add approval timeout", not "Added"). Keep the subject under 72
characters and explain the reasoning in the body if it is not obvious from the diff.

## Code of conduct

Everyone participating in OpenFolk is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
