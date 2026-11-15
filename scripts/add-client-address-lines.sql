-- Migration: add two-line address fields to the clients table.
-- Safe to run multiple times (IF NOT EXISTS guards).
-- Generated with: npx prisma migrate diff --from-schema-datamodel <baseline> --to-schema-datamodel prisma/schema.prisma --script
-- Applied on top of the existing manual-SQL convention (see add-wallet-balance.sql).

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "addressLine1" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "addressLine2" TEXT;

-- Existing rows keep NULL for both columns; the app treats NULL as an empty
-- address and never reinterprets city / companyName / heading as addresses.
