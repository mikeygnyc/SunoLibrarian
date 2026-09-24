# Runtime Smoke Test

The unified CLI does not expose a `run-supervisor` command. Start each runtime
explicitly when testing a multi-process deployment.

```bash
source ~/.nvm/nvm.sh
nvm use
npm run build
```

In separate terminals, start the API, one worker for each role needed, and any
workspace-specific librarian:

```bash
npm run start:api -- --host 127.0.0.1 --port 3000 --postgres-url "$POSTGRES_URL" --mqtt-url "$MQTT_URL"
npm run start:worker -- --role asset --postgres-url "$POSTGRES_URL" --mqtt-url "$MQTT_URL"
npm run start:librarian -- --workspace <workspace-id> --browser http://localhost:9222 --database-type postgres --postgres-url "$POSTGRES_URL" --mqtt-url "$MQTT_URL"
```

Check the API from another terminal:

```bash
npm start -- api-health --api-url http://127.0.0.1:3000
```

Use `run-worker --help` and `run-librarian --help` for the full runtime option
sets. Start additional worker processes explicitly for each required role.
