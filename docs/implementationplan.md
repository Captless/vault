# Personal Vault — Implementation Plan

**Status:** Finalized  
**Product:** Local-first encrypted file vault  
**Deployment:** Cloudflare Pages  
**Backend:** None  
**Database:** IndexedDB (local only)

---

## 1. Product Overview

Personal Vault is a private, local-first file-management application designed to securely store documents, files, and folders.

The application behaves like a minimalist file manager, allowing users to create folders, write TXT and Markdown documents, upload files, and optionally protect folders with individual passwords.

It also supports a manually configured decoy mechanism for text documents. When someone enters an incorrect password for a protected folder, the application displays alternative decoy text instead of the original documents.

All user data remains encrypted and stored locally in the browser.

Cloudflare Pages is used exclusively to deploy and serve the application. No cloud database, backend, remote storage, or synchronization is included.

### Core Decisions

| Component | Decision |
|---|---|
| Language | TypeScript |
| Frontend | React |
| Build tool | Vite |
| Styling | Tailwind CSS |
| Database | IndexedDB |
| Database wrapper | Dexie.js |
| Encryption | AES-256-GCM |
| Key derivation | Argon2id |
| Cryptographic API | Web Crypto API |
| PWA | Vite PWA |
| Deployment | Cloudflare Pages |
| Authentication | User-created master password |
| Folder protection | Optional individual folder passwords |
| File protection | Inherited from parent folder |
| Decoy mechanism | TXT and Markdown only |
| Backup | Encrypted export tied to master password |
| Synchronization | None |
| Backend | None |

### Product Boundaries

- One independent vault per browser origin and browser profile.
- No cloud accounts or remote authentication.
- No automatic synchronization between devices.
- No server-side file storage.
- No password recovery service.
- No automatic decoy generation.
- No file-level passwords.
- No preview pane.
- No AI functionality.

Installing the PWA on another device creates a separate local vault. Moving data between devices requires manual backup and restoration.

---

## 2. Application Architecture

### 2.1 Architecture Overview

```text
Personal Vault
│
├── React Application
│   ├── Authentication
│   ├── File Explorer
│   ├── Folder Management
│   ├── Document Editor
│   ├── File Upload
│   ├── File Viewer
│   ├── Folder Protection
│   ├── Decoy Management
│   └── Backup / Restore
│
├── Application Services
│   ├── VaultService
│   ├── FolderService
│   ├── DocumentService
│   ├── FileService
│   ├── CryptoService
│   ├── BackupService
│   └── SnapshotService
│
├── Security Layer
│   ├── Argon2id
│   ├── AES-256-GCM
│   ├── Key Management
│   ├── Encryption / Decryption
│   └── Session Management
│
└── IndexedDB
    ├── Vault Metadata
    ├── Folders
    ├── Items
    ├── Binary Files
    ├── Decoy Records
    ├── Folder Keys
    └── Snapshots
```

### 2.2 Proposed Project Structure

```text
src/
├── app/
│   ├── App.tsx
│   ├── router.tsx
│   └── providers/
│
├── components/
│   ├── layout/
│   ├── explorer/
│   ├── dialogs/
│   ├── editor/
│   └── shared/
│
├── features/
│   ├── auth/
│   ├── vault/
│   ├── folders/
│   ├── documents/
│   ├── uploads/
│   ├── decoys/
│   ├── backup/
│   └── settings/
│
├── services/
│   ├── vault.service.ts
│   ├── folder.service.ts
│   ├── document.service.ts
│   ├── file.service.ts
│   ├── crypto.service.ts
│   ├── backup.service.ts
│   └── snapshot.service.ts
│
├── db/
│   ├── database.ts
│   ├── schema.ts
│   └── migrations/
│
├── security/
│   ├── kdf.ts
│   ├── encryption.ts
│   ├── key-management.ts
│   ├── session.ts
│   └── validation.ts
│
├── hooks/
├── types/
├── utils/
├── styles/
└── main.tsx
```

This is a proposed structure. Inspect the existing repository before creating files. Reuse existing architecture and functionality where appropriate.

---

## 3. Authentication and Encryption

Security is a foundational requirement, not an optional implementation detail.

### 3.1 Master Password Setup

On first launch:

1. Check whether a vault already exists.
2. Display the master password creation screen.
3. Require the user to enter and confirm a password.
4. Generate a cryptographically secure random salt.
5. Derive a 256-bit wrapping key using Argon2id.
6. Generate a random vault data-encryption key (DEK).
7. Wrap the vault DEK using the derived master-password key.
8. Generate an encrypted verification payload.
9. Store the encrypted key and necessary cryptographic metadata in IndexedDB.

Never store the master password or plaintext encryption keys.

### 3.2 Master Password Login

On subsequent visits:

1. Display the master password screen.
2. Load the stored KDF parameters and wrapped vault key.
3. Derive the wrapping key using Argon2id.
4. Attempt to unwrap the vault DEK.
5. Verify the encrypted authentication payload.
6. If successful, initialize the unlocked application session.
7. If unsuccessful, display an incorrect-password message.

The decrypted vault key must remain in memory only.

### 3.3 Encryption Requirements

Use:

- AES-256-GCM for authenticated encryption.
- Argon2id for password-based key derivation.
- Cryptographically secure random salts.
- Unique random 96-bit IVs for AES-GCM.
- Authenticated additional data (AAD) to bind ciphertext to its record and encryption context.

Every encrypted record must include:

- Encryption algorithm/version.
- IV.
- Ciphertext.
- Relevant encryption context.

Never implement custom cryptographic algorithms.

### 3.4 Master Password Change

The user can change their master password through Settings.

Process:

1. Request the current master password.
2. Verify the current password.
3. Unwrap the existing vault DEK.
4. Generate a new salt.
5. Derive a new wrapping key.
6. Re-wrap the existing vault DEK.
7. Update authentication metadata.

Existing file contents do not need to be re-encrypted because the underlying vault DEK remains unchanged.

---

## 4. Folder Password Protection

Folder protection is the primary additional access-control mechanism.

### 4.1 Folder Protection Behavior

Every folder can be:

- Unprotected.
- Password-protected.

Unprotected folders use the vault encryption key.

Protected folders use their own independently generated folder encryption key.

Files and subfolders inherit their parent folder's protection.

There are no individual file passwords.

### 4.2 Enabling Protection

When enabling protection:

1. Open folder settings.
2. Select Protect Folder.
3. Enter and confirm a new password.
4. Generate a random folder salt.
5. Derive a wrapping key using Argon2id.
6. Generate a random folder DEK.
7. Wrap the folder DEK using the folder password.
8. Encrypt the folder's private metadata and contents using the folder DEK.
9. Verify the encrypted records.
10. Commit the protection conversion safely.

Do not delete original records until the replacement encrypted records are verified and committed.

### 4.3 Opening Protected Folders

When opening a protected folder:

1. Display a password dialog.
2. Derive a candidate wrapping key.
3. Attempt to unwrap the folder DEK.
4. Verify the encrypted authentication payload.
5. If valid, unlock the folder.
6. If invalid, enter the decoy-view state.

### 4.4 Disabling Protection

Require the existing folder password.

1. Unlock the folder.
2. Decrypt its contents.
3. Re-encrypt them using the vault DEK.
4. Verify the resulting records.
5. Remove folder protection metadata only after successful migration.

### 4.5 Moving Files

When moving files:

- Unprotected to unprotected: retain or re-encrypt using the vault DEK as required by the record context.
- Unprotected to protected: encrypt using the destination folder DEK.
- Protected to unprotected: decrypt using the source folder DEK and re-encrypt using the vault DEK.
- Protected to protected: require both folder sessions and re-encrypt using the destination folder DEK.

All operations must preserve data integrity.

---

## 5. Decoy Text Mechanism

### 5.1 Scope

Decoy content is supported only for:

- TXT documents.
- Markdown documents.

Decoy content must be manually configured by the user.

Uploaded files such as PDFs, images, videos, and archives do not support decoy content.

### 5.2 Document Decoy Configuration

Each supported document can have:

- Original content.
- Optional decoy content.

The user can configure the decoy through the document's settings.

Both payloads must be stored encrypted.

### 5.3 Correct Password

When the correct folder password is entered:

- Decrypt the folder DEK.
- Open the real folder.
- Display original documents.
- Display actual folder contents.
- Allow normal editing and file operations.

### 5.4 Incorrect Password

When the incorrect password is entered:

- Do not unlock the real folder.
- Enter a separate decoy-view state.
- Display configured decoy TXT and Markdown documents.
- Hide real filenames and private metadata.
- Hide real folder structure and nested-folder contents.
- Do not expose real binary files.
- Display neutral placeholders or omit unsupported items.

The user should see a coherent alternative document view rather than an explicit incorrect-password error after entering the folder.

### 5.5 Decoy Editing

Decoy content must never overwrite original content.

If decoy editing is implemented:

- Save changes only to the decoy payload.
- Keep real document records untouched.
- Clearly isolate real and decoy application state.

### 5.6 Security Limitation

Decoy mode is an alternate application view, not forensic-proof plausible deniability.

A technically capable attacker may discover decoy records through IndexedDB inspection, source inspection, memory inspection, or a compromised browser environment.

Do not advertise this feature as protection against forensic analysis.

---

## 6. File Management

### 6.1 Main File Explorer

The primary interface should provide:

- Root vault navigation.
- Folder creation.
- Nested folders.
- File creation.
- File uploads.
- Search.
- Sorting.
- Breadcrumb navigation.
- Rename.
- Move.
- Duplicate.
- Delete.
- Multi-selection where appropriate.
- Context menus.
- Storage usage information.

The interface should resemble a minimalist desktop file manager.

### 6.2 TXT Documents

Users can:

- Create TXT documents.
- Edit existing documents.
- Rename documents.
- Save changes.
- Delete documents.
- Configure optional decoy text.

Use UTF-8 text encoding.

Implement autosave with a deliberate debounce and visible save status.

Warn users about unsaved changes before navigation.

### 6.3 Markdown Documents

Users can:

- Create Markdown documents.
- Edit Markdown.
- Preview rendered Markdown.
- Switch between editing and reading modes.
- Configure optional decoy Markdown.

Sanitize rendered Markdown.

Do not allow arbitrary script execution or unsafe embedded HTML.

Disable automatic remote image and resource loading by default.

### 6.4 File Uploads

Support general file uploads, including:

- PDF.
- PNG.
- JPG.
- WebP.
- GIF.
- MP4.
- WebM.
- MP3.
- WAV.
- ZIP.
- Other browser-supported file types.

Requirements:

- Encrypt file bytes before persistence.
- Preserve original filenames and MIME metadata in encrypted metadata.
- Support multiple-file uploads.
- Show upload progress.
- Support cancellation.
- Enforce a practical file-size limit.
- Handle IndexedDB quota errors.
- Never treat incomplete uploads as completed files.
- Never execute uploaded files.

Large files must be handled with a tested storage strategy. If chunked encryption is implemented, each chunk must use a unique IV and authenticated chunk context.

### 6.5 File Viewers

Provide dedicated viewers:

| File type | Behavior |
|---|---|
| TXT | Text editor |
| Markdown | Markdown editor and preview |
| PDF | Browser PDF viewer |
| Images | Image viewer |
| Video | Native video controls |
| Audio | Native audio controls |
| Other | File information and download |

Revoke object URLs when closing viewers, deleting files, or locking the vault.

Unsupported file formats remain downloadable.

Do not build a preview pane.

---

## 7. IndexedDB Database Design

Use Dexie.js with versioned database migrations.

### 7.1 vaultMeta

Stores:

- Vault ID.
- Creation timestamp.
- Schema version.
- KDF algorithm.
- KDF parameters.
- Master password salt.
- Wrapped vault DEK.
- Verification ciphertext.
- Verification IV.
- Cryptographic format version.
- Application settings.

### 7.2 folders

Stores:

- Folder ID.
- Parent folder ID.
- Protection mode.
- Folder key reference.
- Encrypted folder metadata.
- IV.
- Creation timestamp.
- Modification timestamp.

Protected folder names and private metadata must not be exposed in plaintext while locked.

### 7.3 folderKeys

Stores:

- Folder ID.
- KDF algorithm.
- Salt.
- KDF parameters.
- Wrapped folder DEK.
- Wrapping IV.
- Encrypted verification payload.
- Verification IV.
- Cryptographic version.

### 7.4 items

Stores:

- Item ID.
- Parent folder ID.
- Item type.
- Encrypted metadata.
- Metadata IV.
- Encrypted payload or binary reference.
- Payload IV.
- Encryption scope.
- MIME type.
- File size.
- Creation timestamp.
- Modification timestamp.
- Cryptographic version.

### 7.5 binaryBlobs

Stores:

- Blob ID.
- Item ID.
- Encrypted file bytes.
- IV.
- Optional chunk index.
- Cryptographic version.

### 7.6 decoys

Stores:

- Decoy ID.
- Original item ID.
- Encrypted decoy payload.
- IV.
- Creation timestamp.
- Modification timestamp.
- Cryptographic version.

Only TXT and Markdown documents can have decoy records.

### 7.7 snapshots

Stores:

- Snapshot ID.
- Timestamp.
- Snapshot reason.
- Schema version.
- Encrypted snapshot data.
- IV.
- Size.

### 7.8 Database Rules

- Use stable random IDs.
- Use Dexie transactions for related operations.
- Validate all data before persistence.
- Handle orphaned records and blobs.
- Encrypt sensitive metadata.
- Never persist plaintext document contents.
- Never persist plaintext passwords or keys.
- Avoid plaintext search indexes.
- Implement safe cascading deletion.
- Use explicit database migrations.

---

## 8. Backup and Restore

### 8.1 Backup Model

The selected backup strategy is an encrypted export tied to the current master password.

There is no separate backup password.

The exported file uses the `.vaultbackup` extension.

### 8.2 Export Process

1. Require an unlocked vault.
2. Require recent master-password re-authentication.
3. Generate a consistent logical snapshot.
4. Include all folders, items, binary files, decoy records, and required cryptographic metadata.
5. Preserve protected folder encryption envelopes.
6. Serialize the backup into a versioned format.
7. Generate a fresh backup salt.
8. Derive a backup encryption key from the master password using Argon2id.
9. Encrypt the complete backup payload using AES-256-GCM.
10. Include the format version, KDF parameters, salt, IV, and authenticated header.
11. Trigger a local download.

The backup must never contain plaintext passwords, plaintext encryption keys, or plaintext document contents.

### 8.3 Import Process

1. User selects a `.vaultbackup` file.
2. Validate its public header.
3. Reject malformed or unsupported backup versions.
4. Request the master password associated with the backup.
5. Derive the backup key using Argon2id.
6. Decrypt and authenticate the backup.
7. Validate the complete decrypted structure.
8. Verify record references and cryptographic envelopes.
9. Show a restoration confirmation.
10. Restore transactionally.

Never silently overwrite an existing vault.

If restoration fails, preserve the existing vault unchanged.

### 8.4 Password Compatibility

A backup exported before changing the master password still requires the old master password.

The interface must explain this clearly.

### 8.5 Automatic Local Snapshots

Implement bounded local snapshots.

Create snapshots before:

- Bulk deletion.
- Folder protection conversion.
- Bulk movement.
- Backup restoration.
- Other high-risk operations.

Requirements:

- Encrypt snapshots.
- Maintain a bounded history.
- Limit total storage consumption.
- Display snapshot timestamps.
- Allow explicit restoration.
- Validate snapshots before restoration.

Snapshots are not substitutes for exported backups because they share the same browser storage failure domain.

---

## 9. PWA and Local Storage

### 9.1 PWA Requirements

- Installable PWA.
- Valid web app manifest.
- Application icons.
- Offline application-shell caching.
- Update notifications.
- Safe application updates.
- Responsive desktop and mobile layouts.

### 9.2 Service Worker Rules

Cache only:

- Application shell.
- Static assets.
- Required application resources.

Never cache:

- Decrypted files.
- User documents.
- Backup files.
- Sensitive runtime data.
- Plaintext passwords or encryption keys.

### 9.3 Browser Storage

Use IndexedDB for all persistent vault data.

Implement:

- `navigator.storage.persist()` where supported.
- `navigator.storage.estimate()` where supported.
- Storage usage display.
- Quota error handling.
- Storage warnings.
- Upload size limits.

The application must explain that browser storage can still be deleted or evicted.

### 9.4 Cloudflare Pages

Cloudflare Pages hosts the static production application.

Do not introduce:

- Cloudflare D1.
- Cloudflare R2.
- Cloudflare KV.
- Server-side authentication.
- Cloudflare Workers API.
- Remote file upload endpoints.

Configure:

- HTTPS.
- SPA fallback routing.
- Security headers.
- Restrictive Content Security Policy compatible with the build and WASM-based Argon2id implementation.

Preview deployments and production deployments use different origins and therefore different IndexedDB storage.

---

## 10. UI and Design System

### 10.1 Design Direction

The interface must be a polished, minimalist white file manager.

Use JetBrains Mono as the primary typography family.

Design principles:

- White and near-white backgrounds.
- Neutral gray borders.
- Consistent spacing.
- Clean alignment.
- Restrained typography.
- Compact but comfortable controls.
- Subtle hover and focus states.
- Minimal shadows.
- Consistent iconography.
- Modest corner radii.
- No unnecessary decorative elements.

Avoid:

- Generic SaaS dashboards.
- Large hero sections.
- Excessive rounded cards.
- Gradients.
- Glassmorphism.
- Unnecessary illustrations.
- Decorative charts.
- Inconsistent button styles.
- Excessive animations.

### 10.2 Desktop Layout

- Narrow left navigation sidebar.
- Main file-management area.
- Breadcrumb navigation.
- Top toolbar.
- File and folder list.
- Contextual action menus.
- Dedicated document editor and viewers.

### 10.3 Mobile Layout

The application must remain usable as an installed phone PWA.

Requirements:

- Responsive single-column layout.
- Sidebar converted into a drawer or compact navigation.
- Accessible touch targets.
- No hover-only actions.
- Mobile-friendly file upload.
- Full-screen editor and viewer where appropriate.
- Proper dialog sizing.
- No horizontal overflow.

### 10.4 Required Screens

1. First-run master password setup.
2. Master password login.
3. Main file explorer.
4. Folder creation dialog.
5. TXT document creation.
6. Markdown document creation.
7. TXT editor.
8. Markdown editor and preview.
9. File upload interface.
10. PDF viewer.
11. Image viewer.
12. Video/audio viewer.
13. Folder password setup.
14. Folder password unlock.
15. Decoy document editor.
16. Decoy folder view.
17. Backup export.
18. Backup import and restore.
19. Snapshot history.
20. Settings.
21. Master password change.
22. Storage information.
23. Destructive action confirmation.

### 10.5 Typography

Use JetBrains Mono throughout the application.

Self-host the font where practical.

Maintain consistent font weights, sizes, line heights, and spacing.

Do not mix unrelated typography families.

---

## 11. Security Requirements

### 11.1 Threat Model

The application aims to protect encrypted data at rest against casual inspection and unauthorized access by someone without the relevant passwords.

It does not guarantee protection against:

- Malware.
- Keyloggers.
- Compromised operating systems.
- Malicious browser extensions.
- XSS or compromised same-origin scripts.
- Memory inspection while unlocked.
- Physical destruction.
- Browser storage eviction.
- Forensic analysis of decoy records.

### 11.2 Mandatory Security Controls

- Encrypt all sensitive content before IndexedDB persistence.
- Never store plaintext passwords.
- Never store plaintext encryption keys.
- Use authenticated encryption.
- Use unique IVs.
- Use Argon2id with unique salts.
- Validate imported backups.
- Sanitize Markdown.
- Avoid third-party analytics.
- Avoid unnecessary remote scripts.
- Apply restrictive CSP.
