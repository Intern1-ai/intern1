# TODO

- [ ] Investigate using Firefox with Playwright MCP (`--browser=firefox`) to avoid Chrome's namespace sandbox issue, removing the need for `SYS_ADMIN` capability in docker-compose.yml. Chrome currently requires `cap_add: SYS_ADMIN` + `--no-sandbox` which weakens container isolation.
