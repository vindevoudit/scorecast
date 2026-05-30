const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Group = sequelize.define(
    'Group',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      // Phase 0 T29-1 — 6-char uppercase hex tag rendered alongside name
      // so duplicate group names stay visually distinct ("Friday Football
      // #A3F2D1" vs "Friday Football #7BE091"). Server-set on createGroup
      // via crypto.randomBytes(3); never user-input. Unique across all
      // groups (DB-level UNIQUE INDEX).
      discriminator: {
        type: DataTypes.CHAR(6),
        allowNull: false,
      },
      ownerId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // Tier 19 Chunks 1+3 — three-tier visibility:
      //   public  → free join, fully discoverable
      //   private → discoverable; joinable via request / invite / password
      //   secret  → hidden; invite-only (the legacy "private" semantic)
      // Existing rows were transparently renamed 'private' → 'secret' by
      // migration 20260527000001 so their original invite-only intent is
      // preserved. Default for new groups is 'secret' (most conservative).
      visibility: {
        type: DataTypes.ENUM('public', 'private', 'secret'),
        allowNull: false,
        defaultValue: 'secret',
      },
      // Tier 19 Chunk 1 — optional bcrypt-hashed password for private
      // groups. NULL means "no password set" (request-to-join or invite
      // only). Service layer nulls this column out whenever visibility
      // flips away from 'private' so a re-promotion to private doesn't
      // accidentally inherit a stale password.
      passwordHash: {
        type: DataTypes.STRING(72),
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'groups',
      timestamps: false,
    },
  );

  return Group;
};
