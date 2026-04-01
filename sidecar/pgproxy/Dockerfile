FROM public.ecr.aws/debian/debian:bookworm-slim

RUN apt-get update && apt-get install -y curl ca-certificates unzip && rm -rf /var/lib/apt/lists/*

# Install session-manager-plugin (required for SSM port forwarding)
RUN curl -fsSL "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb" \
    -o /tmp/session-manager-plugin.deb \
    && dpkg -i /tmp/session-manager-plugin.deb \
    && rm /tmp/session-manager-plugin.deb

# Copy pre-downloaded cmtpgproxy binary (from private GitHub release)
COPY cmtpgproxy-linux-amd64 /usr/local/bin/cmtpgproxy
RUN chmod +x /usr/local/bin/cmtpgproxy

EXPOSE 13626

CMD ["cmtpgproxy", "-port", "13626", "-loglevel", "info"]
