resource "aws_secretsmanager_secret" "claude-config" {
  name        = "${var.token}/${var.service-name}/claude_config"
  description = "Claude CLI configuration for ${var.service-name} (base64 tar.gz of ~/.claude)"
}
