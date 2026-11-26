# Recall Online pilot

Pushes to `recall-online` deploy to the GitHub Actions Environment
`recall-online.gmrodrigues.com`.

Provision a D1 database named `recall-online-pilot` in the Cloudflare account
that owns the hostname's zone. Set the Environment variables
`CLOUDFLARE_ACCOUNT_ID` and `RECALL_D1_DATABASE_ID`, and its secret
`CLOUDFLARE_API_TOKEN`. Scope the token to the target account and zone with
permissions for Worker deployment, the Custom Domain, and D1 migrations.

Run `bash online/smoke.sh` after installing dependencies to verify the local
Worker with an isolated D1 database. In production, `GET /health` returns
the deployed Git SHA and confirms that D1 contains the synthetic marker.

If a subsequent deployment fails its remote check, use Wrangler rollback
with the last healthy Worker version ID. Keep the existing D1 database and
rerun the HTTPS health check against the restored SHA. For an initial
deployment failure, correct the cause and rerun the workflow.
