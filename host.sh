#!/bin/bash
echo "Visit http://localhost:6080"
docker run -p 6080:80 \
    -v $PWD/public:/usr/share/caddy \
    -v caddy_data:/data \
    caddy