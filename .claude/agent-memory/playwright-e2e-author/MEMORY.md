# Memory index

- [Auth test harness](auth-test-harness.md) — confirmed credentials, ports, storageState patterns, and the project-level inheritance gotcha
- [Stable selectors — auth](stable-selectors-auth.md) — reliable selectors for the login page, NavBar, and post-login state
- [Agent provisioning](agent-provisioning.md) — location and invocation of the server-side agent user helper
- [API endpoints](api-endpoints.md) — which backend routes exist and what auth they require
- [Users page selectors](users-page-selectors.md) — dialog scoping, row-by-email helper, unique name/email pattern, CardTitle gotcha, AlertDialog role
- [Env loading in runner](env-loading-in-runner.md) — how backend/.env.test is parsed into process.env for specs; why dotenv isn't used; pattern for reading env vars in spec code
- [Tickets page selectors](tickets-page-selectors.md) — selectors for /tickets UI, GET /api/tickets shape/ordering, webhook seeding via authenticated `request`, relative-ordering assertion pattern
