# Deploying TITAN // COMMS on Render

This project is configured as a Render Node web service. It serves the web UI and WebSocket endpoint from the same process.

## Recommended setup

1. Push this repository to GitHub or GitLab.
2. In Render, choose **New → Web Service** and select the repository.
3. Use these settings:

   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Health check path:** `/healthz`

4. Deploy the service.
5. Open the generated `https://...onrender.com` URL.

Render provides the `PORT` environment variable automatically. The server listens on `0.0.0.0` and uses the same HTTPS host for secure WebSockets (`wss://`) in the browser.

## Connecting multiple people

The host and visitors must use the same channel code. Only one host can be active in a channel; visitors can join without a limit enforced by this demo.

The included `render.yaml` can also be used with Render Blueprint deployment.
