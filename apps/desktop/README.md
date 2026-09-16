# QurioDB - Desktop Build Guide

This directory contains the **Tauri 2** desktop wrapper for QurioDB. It bundles the Vite/React frontend and the Python FastAPI backend into standalone desktop installers.

## 🏛 Architecture

```
┌──────────────────────────────────────────┐
│          Tauri Desktop Application       │
│                                          │
│  ┌────────────┐    ┌──────────────────┐  │
│  │  WebView   │    │ Backend Sidecar  │  │
│  │ (Vite/     │◄──►│ (api.exe via     │  │
│  │  React)    │    │  PyInstaller)    │  │
│  └────────────┘    └──────────────────┘  │
│                                          │
│  Lifecycle: single-instance → spawn →    │
│             dynamic health-check → run   │
│  Shutdown:  CloseRequested → kill child  │
└──────────────────────────────────────────┘
```

## 🛠 Prerequisites

Ensure you have the following installed on your Windows system:

1.  **Rust & Cargo**: Follow instructions at [rustup.rs](https://rustup.rs/).
2.  **MingW-w64**: Required for the `x86_64-pc-windows-gnu` target.
3.  **Bun**: For frontend build and task orchestration.
4.  **Python 3.7+**: For building the backend sidecar.
5.  **Tauri CLI**: `bun install -g @tauri-apps/cli`

## 🏗 Quy trình Build Toàn diện (Frontend + Backend)

Để tạo ra bộ cài desktop hoàn chỉnh (.exe hoặc .msi), bạn có thể sử dụng quy trình tự động hóa đã được thiết lập sẵn.

### 1. Build Tự động (Khuyên dùng)

Chạy lệnh duy nhất sau từ **thư mục gốc** của repository:

```powershell
# Windows: Build Backend -> Build Frontend -> Đóng gói Tauri
bun run desktop:build

# Linux: Build Backend -> Build Frontend -> Đóng gói Tauri
bun run desktop:build:linux
```

**Lệnh này thực hiện:**

1.  **Build BE**: Sử dụng PyInstaller để đóng gói Python API (thông qua `build-backend.ps1` trên Windows hoặc `build-sidecar.sh` trên Linux).
2.  **Copy BE**: Di chuyển file `api-*.exe` vào thư mục sidecar của Tauri (`src-tauri/bin/`).
3.  **Build FE**: Chạy `bun run build` của ứng dụng Web (`apps/web/dist/`).
4.  **Tauri Bundle**: Biên dịch lõi Rust và đóng gói tất cả vào một trình cài đặt duy nhất.

### 2. Quy trình cho Nhà phát triển (Developer Only)

Ứng dụng đã được tích hợp logic tự động khởi tạo cơ sở dữ liệu (`Auto-Setup & Seeding`) ngay khi khởi động. Tuy nhiên, nếu bạn muốn can thiệp thủ công:

#### Bước A: Seeding Database thủ công (Tùy chọn)

```bash
cd apps/api
venv/Scripts/python scripts/seed.py
```

#### Bước B: Build Backend Sidecar

```powershell
# Thực hiện tại thư mục gốc
powershell -ExecutionPolicy Bypass -File build-backend.ps1 -Target gnu
```

#### Bước C: Build Tauri App (Frontend + Rust)

```bash
export RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu
export PATH="/c/ProgramData/mingw64/mingw64/bin:$PATH"
cd apps/desktop
bun run tauri build --target x86_64-pc-windows-gnu
```

## 📂 Output Locations

After a successful build, you can find the installers here:

- **MSI Installer**: `src-tauri/target/x86_64-pc-windows-gnu/release/bundle/msi/`
- **NSIS (.exe) Setup**: `src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/`

## ⚙️ Configuration Notes

- **Sidecars**: Configured in `tauri.conf.json` under `bundle.externalBin`.
- **Resources**: Environment files and credential-bearing files are not bundled. Desktop runtime settings are passed directly to the sidecar by Tauri.
- **SQLite Database**: Database hệ thống được lưu tại `%APPDATA%\QurioDB\quriodb.db`. Để app cài đặt có dữ liệu mới nhất, bạn cần copy file DB từ môi trường dev vào đường dẫn này.
- **Icon**: The desktop app uses the system's QurioDB logo. Icons are managed in `src-tauri/icons/`.

## 🔴 Xử lý sự cố (Troubleshooting)

- **Lỗi 'NoneType' has no attribute 'close'**: Lỗi này xảy ra khi Backend không khởi tạo được kết nối DB. Giải pháp: Đảm bảo đã chạy các script setup/seed ở Bước 2.A hoặc kiểm tra file log `build_error.log`.
- **Backend không khởi động**: Kiểm tra xem có process `api-*.exe` nào đang chạy ngầm bị treo không. Dùng Task Manager để tắt chúng trước khi chạy lại.

## 🔧 Key Behaviors

### Backend Sidecar Lifecycle

When the desktop app starts:

1. **Single instance**: Tauri focuses the existing window when a second launch is attempted.
2. **Allocate**: The Rust core selects an available loopback port and generates a per-launch nonce.
3. **Spawn**: The Rust core starts the sidecar via `tauri-plugin-shell`, passing `QURIODB_DESKTOP_PORT`, `QURIODB_STARTUP_NONCE`, `QURIODB_DESKTOP_PARENT_PID`, and the desktop-only sidecar settings.
4. **Verify**: Rust checks `GET /api/desktop/health` with the nonce and publishes typed generation/status state containing the dynamic API URL.
5. **Render**: The React `DesktopReadyGuard` configures the API client before rendering the application. If startup fails, it provides **Retry** and **Quit** actions.
6. **Graceful shutdown**: On window close, the owned sidecar process is killed to prevent orphans.

### Security

- Backend binds to `127.0.0.1` (not `0.0.0.0`) to avoid Windows firewall popups. The desktop port is dynamic; browser development still defaults to `127.0.0.1:5000`.
- Use the FastAPI `HOST` environment variable only for intentional web deployments; do not broaden the packaged desktop binding.

### ⚠️ Stale Sidecars (Developer Warning)

When developing the desktop app, Tauri **always** uses the pre-built `api.exe` binaries located in `src-tauri/bin/`.

If you make any changes to the Python code in `apps/api/`, those changes **will not take effect** in the desktop app until you manually rebuild the sidecar using:

- `./build-backend.ps1` (from the root)
- Or running `run-desktop.bat` from the root.

---

_QurioDB Team - v0.1.3_
