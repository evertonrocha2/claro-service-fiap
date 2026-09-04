-- CreateTable
CREATE TABLE `Customer` (
    `id` VARCHAR(191) NOT NULL,
    `cpf` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Customer_cpf_key`(`cpf`),
    UNIQUE INDEX `Customer_email_key`(`email`),
    UNIQUE INDEX `Customer_phone_key`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Service` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `type` ENUM('INTERNET_RESIDENCIAL', 'MOVEL', 'TV') NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',

    INDEX `Service_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invoice` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `serviceId` VARCHAR(191) NULL,
    `dueDate` DATETIME(3) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `barcode` VARCHAR(191) NOT NULL,
    `status` ENUM('OPEN', 'PAID') NOT NULL DEFAULT 'OPEN',

    INDEX `Invoice_customerId_status_idx`(`customerId`, `status`),
    INDEX `Invoice_serviceId_idx`(`serviceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversation` (
    `id` VARCHAR(191) NOT NULL,
    `protocol` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `originChannel` ENUM('SITE', 'APP', 'WHATSAPP') NOT NULL,
    `currentChannel` ENUM('SITE', 'APP', 'WHATSAPP') NOT NULL,
    `intent` ENUM('FATURA_SEGUNDA_VIA', 'PROBLEMA_TECNICO', 'CONSULTA_PLANO', 'CANCELAMENTO', 'FALAR_COM_ATENDENTE', 'DESCONHECIDA') NULL,
    `serviceId` VARCHAR(191) NULL,
    `status` ENUM('BOT', 'WAITING_HUMAN', 'WITH_HUMAN', 'RESOLVED') NOT NULL DEFAULT 'BOT',
    `stage` VARCHAR(191) NOT NULL DEFAULT 'GREETING',
    `collectedData` JSON NULL,
    `consecutiveUnknown` INTEGER NOT NULL DEFAULT 0,
    `assignedAgentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `firstResponseAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Conversation_protocol_key`(`protocol`),
    INDEX `Conversation_customerId_status_idx`(`customerId`, `status`),
    INDEX `Conversation_status_updatedAt_idx`(`status`, `updatedAt`),
    INDEX `Conversation_serviceId_idx`(`serviceId`),
    INDEX `Conversation_assignedAgentId_idx`(`assignedAgentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Message` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `channel` ENUM('SITE', 'APP', 'WHATSAPP') NOT NULL,
    `direction` ENUM('INBOUND', 'OUTBOUND') NOT NULL,
    `sender` ENUM('CUSTOMER', 'BOT', 'AGENT') NOT NULL,
    `text` TEXT NOT NULL,
    `intent` ENUM('FATURA_SEGUNDA_VIA', 'PROBLEMA_TECNICO', 'CONSULTA_PLANO', 'CANCELAMENTO', 'FALAR_COM_ATENDENTE', 'DESCONHECIDA') NULL,
    `confidence` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Message_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HandoffToken` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `targetChannel` ENUM('SITE', 'APP', 'WHATSAPP') NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,

    UNIQUE INDEX `HandoffToken_code_key`(`code`),
    INDEX `HandoffToken_conversationId_idx`(`conversationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Agent` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('AGENT', 'MANAGER') NOT NULL DEFAULT 'AGENT',

    UNIQUE INDEX `Agent_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IntentCache` (
    `id` VARCHAR(191) NOT NULL,
    `textHash` VARCHAR(191) NOT NULL,
    `intent` ENUM('FATURA_SEGUNDA_VIA', 'PROBLEMA_TECNICO', 'CONSULTA_PLANO', 'CANCELAMENTO', 'FALAR_COM_ATENDENTE', 'DESCONHECIDA') NOT NULL,
    `confidence` DOUBLE NOT NULL,
    `entities` JSON NOT NULL,
    `hits` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `IntentCache_textHash_key`(`textHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Service` ADD CONSTRAINT `Service_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `Service`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `Service`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_assignedAgentId_fkey` FOREIGN KEY (`assignedAgentId`) REFERENCES `Agent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HandoffToken` ADD CONSTRAINT `HandoffToken_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
