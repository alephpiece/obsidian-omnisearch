import { readFileSync, writeFileSync } from 'fs'

const targetVersion = process.env.npm_package_version
console.log(`Bumping version to ${targetVersion}`)

// Keep the release manifest and legacy beta manifest in sync. GitHub Actions
// uploads manifest.json, while older BRAT installations may still read
// manifest-beta.json from the repository.
const manifestPaths = ['manifest.json', 'manifest-beta.json']
const manifests = manifestPaths.map(path => ({
  path,
  manifest: JSON.parse(readFileSync(path, 'utf8')),
}))
const { minAppVersion } = manifests[0].manifest
for (const { path, manifest } of manifests) {
  manifest.version = targetVersion
  writeFileSync(path, JSON.stringify(manifest, null, '\t'))
}

// update versions.json with target version and minAppVersion from manifest.json
const versions = JSON.parse(readFileSync('versions.json', 'utf8'))
versions[targetVersion] = minAppVersion
writeFileSync('versions.json', JSON.stringify(versions, null, '\t'))
