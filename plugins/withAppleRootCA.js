// Expo config plugin: trust Apple's own Root CA for Apple domains.
//
// gsa.apple.com / setup.icloud.com / gateway.icloud.com present certificates
// chained to "Apple Root CA", which is NOT in Android's default trust store, so
// RN's fetch (OkHttp) rejects the TLS handshake ("Unacceptable certificate:
// CN=Apple Root CA"). The Find My login pipeline talks to those hosts, so we add
// Apple's public, self-signed root as an additional trust anchor — scoped to
// apple.com + icloud.com only (system CAs still cover everything else). The cert
// is the genuine Apple Root CA (SHA-256 B0:B1:73:0E:…F0:24), bundled in
// plugins/assets/apple_root_ca.pem.

const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const NSC_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Permit cleartext to the loopback / emulator dev-server hosts so the RN
         Metro bundler still works in debug. Providing a network-security-config
         otherwise overrides Expo's default debug cleartext allowance and breaks
         "expo start" ("CLEARTEXT communication to 10.0.2.2 not permitted"). These
         are loopback / emulator addresses, never real servers, so this is safe. -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">localhost</domain>
        <domain includeSubdomains="true">127.0.0.1</domain>
        <domain includeSubdomains="true">10.0.2.2</domain>
    </domain-config>
    <domain-config>
        <domain includeSubdomains="true">apple.com</domain>
        <domain includeSubdomains="true">icloud.com</domain>
        <trust-anchors>
            <certificates src="system"/>
            <certificates src="@raw/apple_root_ca"/>
        </trust-anchors>
    </domain-config>
</network-security-config>
`;

function withNetworkSecurityFiles(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const resDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
      const rawDir = path.join(resDir, 'raw');
      const xmlDir = path.join(resDir, 'xml');
      fs.mkdirSync(rawDir, { recursive: true });
      fs.mkdirSync(xmlDir, { recursive: true });

      const certSrc = path.join(cfg.modRequest.projectRoot, 'plugins', 'assets', 'apple_root_ca.pem');
      fs.copyFileSync(certSrc, path.join(rawDir, 'apple_root_ca.pem'));
      fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), NSC_XML);
      return cfg;
    },
  ]);
}

function withManifestReference(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) {
      app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    }
    return cfg;
  });
}

module.exports = function withAppleRootCA(config) {
  return withManifestReference(withNetworkSecurityFiles(config));
};
