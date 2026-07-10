# syntax=docker/dockerfile:1
#
# Prime lockdown smoke image — the canonical "Plain Docker" boundary from Pi's
# own docs/containerization.md, pinned to the Pi version this repo is verified
# against (ROADMAP §4).
#
# Build-time network is used ONLY to install the pinned Pi CLI. The smoke itself
# runs the container with `docker run --network none`, i.e. deny-by-default
# egress: the container has no network interface except loopback, so nothing can
# reach pi.dev or any provider endpoint. See tools/lockdown/no-egress-smoke.sh.
#
# --ignore-scripts mirrors Pi's documented Dockerfile (supply-chain hardening:
# no package lifecycle scripts run during install).

FROM node:24-bookworm-slim

# Pin to the repo's verified Pi version. Override with --build-arg if re-pinning
# in the same change as ROADMAP §4 / tools/m0a/collect-evidence.sh.
ARG PI_VERSION=0.80.3

RUN npm install -g --ignore-scripts "@earendil-works/pi-coding-agent@${PI_VERSION}" \
  && pi --version

# The repo resource surface (.pi/settings.json, skills/, themes/) is bind-mounted
# read-only at /workspace by the smoke runner; this is just the default cwd.
WORKDIR /workspace

# No ENTRYPOINT: the smoke runner passes an explicit command per check so the
# recorded exit status maps to a single named check.
