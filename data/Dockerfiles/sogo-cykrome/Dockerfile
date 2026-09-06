# Thin wrapper around mailcow's published SOGo image that patches the
# hardcoded Gravatar URL to point at our own self-hosted avatar CDN.
# See patch-avatar-cdn.sh for why this is needed and how it works.
ARG SOGO_IMAGE_TAG=5.12.10-1
FROM ghcr.io/mailcow/sogo:${SOGO_IMAGE_TAG}

COPY patch-avatar-cdn.sh /patch-avatar-cdn.sh
COPY patch-branding.sh /patch-branding.sh
COPY cykrome-mark.svg /cykrome-mark.svg
RUN chmod +x /patch-avatar-cdn.sh /patch-branding.sh

ENTRYPOINT ["/patch-avatar-cdn.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
