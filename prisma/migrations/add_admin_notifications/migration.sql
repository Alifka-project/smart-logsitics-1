-- CreateTable: admin_notifications
-- Used for: 24h overdue delivery alerts, driver arrival alerts, status change alerts

CREATE TABLE IF NOT EXISTS "admin_notifications" (
    "id" BIGSERIAL NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_admin_notif_unread" ON "admin_notifications"("is_read", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_admin_notif_created" ON "admin_notifications"("created_at" DESC);
