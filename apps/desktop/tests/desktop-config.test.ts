/**
 * @file desktop-config.test.ts
 * @description Tests validating the Tauri desktop configuration files
 * are correctly structured for building the QurioDB desktop app.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Resolve paths relative to project root
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SRC_TAURI = path.join(__dirname, '..', 'src-tauri');
const API_DIR = path.join(PROJECT_ROOT, 'api');
const API_SPECS_DIR = path.join(API_DIR, 'specs');
const DESKTOP_RUNTIME_PATH = path.join(API_DIR, 'core', 'desktop_runtime.py');

describe('Desktop Configuration', () => {
  describe('tauri.conf.json', () => {
    const configPath = path.join(SRC_TAURI, 'tauri.conf.json');

    it('should exist and be valid JSON', () => {
      expect(fs.existsSync(configPath)).toBe(true);
      const raw = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw);
      expect(config).toBeDefined();
    });

    it('should have correct product metadata', () => {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.productName).toBe('QurioDB');
      expect(config.identifier).toBe('com.quriodb.app');
      expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should point frontendDist to Vite output directory', () => {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      // Vite outputs to "dist", not "out" (legacy Next.js)
      expect(config.build.frontendDist).toContain('dist');
      expect(config.build.frontendDist).not.toContain('out');
    });

    it('should configure the backend sidecar in externalBin', () => {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.bundle.externalBin).toContain('bin/api');
    });

    it('should reference icon files that exist', () => {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const icons: string[] = config.bundle.icon;
      expect(icons).toBeDefined();
      expect(icons.length).toBeGreaterThan(0);

      for (const icon of icons) {
        const iconPath = path.join(SRC_TAURI, icon);
        expect(fs.existsSync(iconPath), `Icon file should exist: ${icon}`).toBe(true);
      }
    });

    it('should configure window with reasonable dimensions', () => {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const window = config.app.windows[0];
      expect(window.width).toBeGreaterThanOrEqual(960);
      expect(window.height).toBeGreaterThanOrEqual(600);
      expect(window.resizable).toBe(true);
      expect(window.title).toBe('QurioDB');
    });

    it('should not bundle docker-compose (desktop should not require Docker)', () => {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const resources: string[] = config.bundle.resources || [];
      const hasDocker = resources.some((r) => r.includes('docker-compose'));
      expect(hasDocker).toBe(false);
    });

    it('should not bundle environment files or secret-bearing resources', () => {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const resources: string[] = config.bundle.resources || [];

      expect(resources.some((resource) => /(^|[/\\])\.env$/.test(resource))).toBe(false);
      expect(JSON.stringify(config.bundle)).not.toContain('.env');
    });

    it('should include Uvicorn dynamic imports in the Windows MSVC sidecar spec', () => {
      const spec = fs.readFileSync(
        path.join(API_DIR, 'specs', 'api-x86_64-pc-windows-msvc.spec'),
        'utf-8',
      );

      for (const moduleName of [
        'uvicorn.logging',
        'uvicorn.loops.auto',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan.on',
      ]) {
        expect(spec).toContain(`'${moduleName}'`);
      }
    });

    it('should filter sensitive files from every shipped PyInstaller spec', () => {
      const specs = fs
        .readdirSync(API_SPECS_DIR)
        .filter((name) => /^api-.*\.spec$/.test(name));

      expect(specs).toEqual([
        'api-x86_64-pc-windows-gnu.spec',
        'api-x86_64-pc-windows-msvc.spec',
        'api-x86_64-unknown-linux-gnu.spec',
      ]);

      for (const specName of specs) {
        const spec = fs.readFileSync(path.join(API_SPECS_DIR, specName), 'utf-8');
        expect(spec).toContain('_filter_sensitive_bundle_data');
        expect(spec).toContain('datas = _filter_sensitive_bundle_data(datas)');
        expect(spec).toContain('.env.');
        expect(spec).toContain('.pem');
        expect(spec).toContain('.key');
        expect(spec).toContain('credential');
      }
    });
  });

  describe('Cargo.toml', () => {
    it('should exist and contain required dependencies', () => {
      const cargoPath = path.join(SRC_TAURI, 'Cargo.toml');
      expect(fs.existsSync(cargoPath)).toBe(true);

      const content = fs.readFileSync(cargoPath, 'utf-8');
      expect(content).toContain('tauri');
      expect(content).toContain('tauri-plugin-shell');
      expect(content).toContain('tauri-plugin-log');
      expect(content).toContain('tauri-plugin-single-instance');
      expect(content).toContain('rand');
      expect(content).toContain('reqwest');
      expect(content).toContain('tokio');
    });

    it('should configure dynamic desktop backend startup', () => {
      const backendSource = fs.readFileSync(
        path.join(SRC_TAURI, 'src', 'backend.rs'),
        'utf-8',
      );
      expect(backendSource).toContain('QURIODB_DESKTOP_PORT');
      expect(backendSource).toContain('QURIODB_STARTUP_NONCE');
      expect(backendSource).toContain('/api/desktop/health');
      expect(backendSource).not.toContain('const BACKEND_PORT: u16 = 5000');
    });
  });

  describe('capabilities/default.json', () => {
    it('should exist and grant shell permissions', () => {
      const capPath = path.join(SRC_TAURI, 'capabilities', 'default.json');
      expect(fs.existsSync(capPath)).toBe(true);

      const cap = JSON.parse(fs.readFileSync(capPath, 'utf-8'));
      expect(cap.permissions).toBeDefined();

      // Should have core:default
      const hasCore = cap.permissions.some(
        (p: any) => p === 'core:default' || p?.identifier === 'core:default'
      );
      expect(hasCore).toBe(true);

      // Should have shell execution permissions
      const permStrings = cap.permissions
        .filter((p: any) => typeof p === 'string')
        .join(' ');
      expect(permStrings).toContain('shell');
    });
  });

  describe('Icons', () => {
    it('should have the system QurioDB icon (not default Tauri icon)', () => {
      const iconPath = path.join(SRC_TAURI, 'icons', 'icon.ico');
      expect(fs.existsSync(iconPath)).toBe(true);

      // icon.ico should be larger than 10KB (system logo is detailed)
      const stat = fs.statSync(iconPath);
      expect(stat.size).toBeGreaterThan(10000);
    });

    it('should have all required icon sizes', () => {
      const requiredIcons = [
        'icons/32x32.png',
        'icons/128x128.png',
        'icons/128x128@2x.png',
        'icons/icon.icns',
        'icons/icon.ico',
        'icons/icon.png',
      ];

      for (const icon of requiredIcons) {
        const iconPath = path.join(SRC_TAURI, icon);
        expect(fs.existsSync(iconPath), `Icon should exist: ${icon}`).toBe(true);
      }
    });
  });

  describe('Backend app.py', () => {
    it('should delegate host selection to the desktop runtime helper', () => {
      const appPath = path.join(API_DIR, 'app.py');
      const content = fs.readFileSync(appPath, 'utf-8');

      expect(content).toMatch(/from core\.desktop_runtime import .*resolve_server_host/);
      expect(content).toMatch(/host\s*=\s*resolve_server_host\(\)/);
    });

    it('should define the runtime host policy helper', () => {
      const content = fs.readFileSync(DESKTOP_RUNTIME_PATH, 'utf-8');

      expect(content).toMatch(/def\s+resolve_server_host\s*\(/);
      expect(content).toContain('DESKTOP_PORT_ENV');
      expect(content).toContain('HOST');
      expect(content).toContain('127.0.0.1');
    });
  });
});
