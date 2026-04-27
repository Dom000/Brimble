Usage notes

- Build a workspace image using Railpack (if installed):

```bash
# from repo root
# build client image (example)
railpack build -w brimble-client -t brimble-client:latest
```

- Run container locally with Docker (example):

```bash
docker run -d --name brimble-client -p 8080:8080 brimble-client:latest
```

- Use Caddy to proxy to running containers. Update `Caddyfile` to point to container ports.
