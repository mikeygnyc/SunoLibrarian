
For a real end-to-end test, use run-supervisor in local mode and then submit work into the distributed runtime.

What launches under run-supervisor:

api
orchestrator
workers
one librarian child per discovered workspace, unless excluded or disabled
The cleanest local flow is:

source ~/.nvm/nvm.sh
npm run build
npm start -- run-supervisor \
  --browser http://localhost:9222 \
  --control-plane local \
  --api-port 3000
If you want to use the dedicated app entrypoint instead of the unified CLI, this does the same thing:

source ~/.nvm/nvm.sh
npm run start:supervisor -- \
  --browser http://localhost:9222 \
  --control-plane local \
  --api-port 3000
What you should see:

supervisor starts api first
then orchestrator
then workers
then librarian children for discovered workspaces
each child reports readiness on its health endpoint before supervisor says the topology is healthy
A practical end-to-end test looks like this:

Start Chrome with remote debugging, or point --browser at an existing one.
Start the supervisor:
npm start -- run-supervisor --browser http://localhost:9222
In another terminal, submit a distributed job:
npm start -- sync \
  --runtime-mode distributed \
  --submit-only \
  --browser http://localhost:9222 \
  --output ./downloads
Watch it:
npm start -- watch-job <jobId>
Inspect logs if needed:
npm start -- logs --job-id <jobId>
If you want to verify the API is up while supervision is active:

npm start -- api-health
If you want a tighter, explicit worker setup for testing, I’d use:

npm start -- run-supervisor \
  --browser http://localhost:9222 \
  --worker-topology auth=1,asset=1,processing=1,conversion=1
For Postgres-backed end to end, same flow, just swap control plane config:

npm start -- run-supervisor \
  --browser http://localhost:9222 \
  --control-plane postgres \
  --postgres-url postgres://user:password@localhost:5432/suno_export
A few useful knobs:

--control-plane-dir <path> for local state isolation
--workspace-policy-file <path> to disable specific workspace librarians at runtime
--excluded-workspaces <ids> to skip some workspaces on initial discovery
--api-port, --orchestrator-health-port, --worker-health-port-base, --librarian-health-port-base if you want to avoid port collisions
One important note: local supervisor mode is the real end-to-end path to test right now. That’s the mode we’ve validated. If you want, I can give you a copy-paste two-terminal test recipe tailored to either local control plane or postgres control plane.