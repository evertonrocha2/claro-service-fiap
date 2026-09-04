-- AlterTable
ALTER TABLE `Conversation` ADD COLUMN `contactPhone` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `OfferInsight` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NULL,
    `headline` VARCHAR(191) NOT NULL,
    `rationale` TEXT NOT NULL,
    `offerKind` ENUM('RETENCAO', 'UPGRADE', 'DESCONTO', 'SUPORTE_TECNICO', 'NEGOCIACAO_FATURA', 'NENHUMA') NOT NULL,
    `confidence` DOUBLE NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OfferInsight_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `OfferInsight_conversationId_idx`(`conversationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Conversation_contactPhone_status_idx` ON `Conversation`(`contactPhone`, `status`);

-- AddForeignKey
ALTER TABLE `OfferInsight` ADD CONSTRAINT `OfferInsight_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OfferInsight` ADD CONSTRAINT `OfferInsight_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
