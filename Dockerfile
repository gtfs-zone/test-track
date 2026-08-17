# Serves the built site as an immutable image, deployed to k3s by ArgoCD
# (deploy-gtfs-rt, sites/viz.yaml). Expects `dist/` to exist: run `pnpm build`
# first, which is what CI does before calling docker build.
#
# nginx-unprivileged listens on :8080 as uid 101 and never needs root, so the
# pod can run with runAsNonRoot + readOnlyRootFilesystem.
FROM nginxinc/nginx-unprivileged:1.29-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/

EXPOSE 8080
