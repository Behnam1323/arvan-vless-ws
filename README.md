# ArvanCloud VLESS over WebSocket TCP Relay

Node.js implementation of a real VLESS-over-WebSocket TCP relay intended for an ArvanCloud Container/PaaS deployment.

## Features

- VLESS UUID authentication
- Real outbound TCP connection to the destination requested by the VLESS client
- WebSocket endpoint: `/api/ws`
- TCP relay in both directions
- Node.js `ws` handles WebSocket framing and fragmented messages
- `TCP_NODELAY`
- TCP keepalive
- bounded relay buffering
- basic backpressure handling
- health endpoint at `/health`
- Docker/Container deployment
- no XHTTP
- no fake/mock upstream

## Important Arvan deployment model

The recommended setup is:

Client (v2rayNG)
    |
    | WSS / TLS
    v
film4up.ir
    |
    | TLS termination / routing at Arvan edge
    v
Arvan Container
    |
    | plain HTTP WebSocket inside the platform
    v
Node.js VLESS relay
    |
    | outbound TCP
    v
Destination requested by the client

The application listens on `0.0.0.0:$PORT`. This is important for PaaS/container routing.

If your Arvan setup provides end-to-end TLS into the container instead, `TLS_ENABLED=true` can be used with mounted certificate/key files. Do not enable it unless the platform is actually forwarding TLS to the container.

## Environment variables

Required:

- `UUID`: VLESS UUID

Recommended:

- `PORT`: normally supplied by Arvan
- `WS_PATH=/api/ws`
- `PUBLIC_HOST=film4up.ir`
- `PUBLIC_PORT=443`
- `PUBLIC_TLS=true`
- `PUBLIC_SNI=film4up.ir`

Optional:

- `ALLOWED_HOST=film4up.ir`
- `CONNECT_TIMEOUT_MS=10000`
- `IDLE_TIMEOUT_MS=0`

## Deploy

1. Create a Container/PaaS application in ArvanCloud.
2. Deploy this repository/project using its Dockerfile.
3. Configure the application/container port to the value used by `PORT` (or use the platform-provided `PORT`).
4. Set:
   - `UUID` to a freshly generated UUID
   - `WS_PATH` to `/api/ws`
5. Attach `film4up.ir` to the application using Arvan's domain/routing settings.
6. Enable HTTPS/TLS for `film4up.ir` at the edge.
7. Verify:
   - `https://film4up.ir/health` returns `ok`
   - WebSocket route is `wss://film4up.ir/api/ws`

## Generate a v2rayNG VLESS URL

Locally:

```bash
UUID=$(node -e "console.log(require('crypto').randomUUID())")
UUID="$UUID" PUBLIC_HOST=film4up.ir PUBLIC_PORT=443 PUBLIC_PATH=/api/ws PUBLIC_TLS=true node scripts/generate-config.js
```

Then import the printed VLESS URL into v2rayNG.

The generated URL is for the public Arvan endpoint:

- address: `film4up.ir`
- port: `443`
- network: `ws`
- path: `/api/ws`
- TLS: enabled
- SNI: `film4up.ir`
- encryption: `none`

## Notes

This project intentionally does not implement XHTTP.

The relay is a TCP relay: after successful VLESS authentication, the destination address and port from the VLESS request are used to create a real TCP socket. Data is then relayed in both directions.

The WebSocket library is responsible for WebSocket frame parsing/reassembly; application code does not treat arbitrary chunks as WebSocket frames.

For production use, do not expose an admin panel or UUID/config endpoint without authentication. This project has no public admin endpoint.

## Troubleshooting

### Health works but v2rayNG does not connect

Check:

- TLS is enabled on `film4up.ir`
- `/api/ws` reaches the same container
- UUID exactly matches
- v2rayNG uses WebSocket, not XHTTP
- path is exactly `/api/ws`
- SNI is `film4up.ir`
- the Arvan routing layer supports WebSocket upgrades

### Container starts then exits

Check the logs. A common cause is an invalid `UUID` or an unavailable port configuration.

### Connection authenticates but destination fails

Check outbound TCP connectivity from the container and the requested destination's availability.

## Security

Treat the UUID as a credential. Do not publish it in a repository or screenshots. Rotate it if it becomes public.
