{
  description = "Aether — an AI-driven OSINT analyst on the desktop";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f system nixpkgs.legacyPackages.${system});
      # nixpkgs-unstable renames and drops attributes without warning, and a
      # single missing one fails the whole flake at evaluation. `pick` takes the
      # first name that exists so a rename degrades instead of breaking.
      pick = pkgs: names:
        let found = builtins.filter (n: pkgs ? ${n}) names;
        in if found == [] then null else pkgs.${builtins.head found};
      pickList = pkgs: names: builtins.filter (p: p != null) (map (n: pick pkgs [ n ]) names);
    in
    {
      # ── dev shell ─────────────────────────────────────────────────────────
      #   nix develop     then   npm install && npm run dev
      devShells = forAll (system: pkgs:
        let
          inherit (pkgs) lib stdenv;
          # Electron's postinstall downloads a prebuilt binary from the network,
          # which is exactly what Nix is trying to avoid. Point the toolchain at
          # the electron in nixpkgs instead and skip the download entirely.
          electron = pick pkgs [ "electron_33" "electron_32" "electron" ];
        in
        {
          default = pkgs.mkShell {
            # pick can return null if nixpkgs dropped every candidate name; a
            # null in this list would fail evaluation, which is the exact thing
            # the helper exists to prevent.
            packages = builtins.filter (p: p != null) ([
              (pick pkgs [ "nodejs_22" "nodejs_20" "nodejs" ])
              pkgs.node-gyp
              pkgs.python3     # node-gyp needs it for any native rebuild
              electron
            ] ++ lib.optionals stdenv.hostPlatform.isLinux (pickList pkgs [
              # Chromium's runtime deps. Without these the window opens on a
              # missing-symbol crash rather than a useful error. Names only —
              # pickList drops any that this nixpkgs no longer carries.
              "pkg-config"
              "glib" "nss" "nspr" "atk" "at-spi2-atk" "at-spi2-core" "cups" "dbus"
              "gtk3" "pango" "cairo" "gdk-pixbuf" "libdrm" "libgbm" "mesa"
              "libxkbcommon" "alsa-lib" "expat" "systemd"
            ]) ++ lib.optionals stdenv.hostPlatform.isLinux (with pkgs.xorg; [
              libX11 libXcomposite libXdamage libXext libXfixes libXrandr
              libxcb libXcursor libXi libXrender libXtst
            ]));

            env = {
              ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
              ELECTRON_OVERRIDE_DIST_PATH = "${electron}/libexec/electron";
            };

            shellHook = ''
              echo "Aether dev shell — node $(node -v), electron ${electron.version}"
              echo "  npm install && npm run dev      run the app"
              echo "  npm run preview:web             renderer only, in a browser on :5199"
              echo "  npm run typecheck               tsc, both projects"
            '';
          };
        });

      # ── package ───────────────────────────────────────────────────────────
      #   nix build
      #
      # The npm dependency closure is pinned by npmDepsHash below, and nixpkgs
      # by flake.lock. Both are checked on every push by .github/workflows/nix.yml,
      # so a stale hash shows up as a red build rather than as an issue report.
      packages = forAll (system: pkgs:
        let
          inherit (pkgs) lib stdenv;
          electron = pick pkgs [ "electron_33" "electron_32" "electron" ];
        in
        lib.optionalAttrs stdenv.hostPlatform.isLinux {
          default = pkgs.buildNpmPackage rec {
            pname = "aether";
            version = (lib.importJSON ./package.json).version;
            src = self;

            # Content hash of the npm dependency closure, derived from
            # package-lock.json. Regenerate after ANY lock change with:
            #   nix run nixpkgs#prefetch-npm-deps -- package-lock.json
            # A wrong value fails the build loudly; it can never make Nix accept
            # different content, because this is a fixed-output derivation.
            npmDepsHash = "sha256-aK5OXBx/2d9dokpjzEQh57s6igzT9lrbkxF6lSCcyTg=";

            nativeBuildInputs = [ pkgs.makeWrapper pkgs.copyDesktopItems ];

            ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
            ELECTRON_OVERRIDE_DIST_PATH = "${electron}/libexec/electron";

            # electron-builder wants to package and sign a distributable; under
            # Nix we only need the compiled bundle, and wrap the nixpkgs electron
            # around it ourselves.
            buildPhase = ''
              runHook preBuild
              npm run build
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p $out/share/aether
              cp -r out package.json $out/share/aether/
              cp -r node_modules $out/share/aether/
              makeWrapper ${electron}/bin/electron $out/bin/aether \
                --add-flags $out/share/aether \
                --set-default ELECTRON_IS_DEV 0 \
                --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath (pickList pkgs [ "libgbm" "mesa" ])}"
              runHook postInstall
            '';

            desktopItems = [
              (pkgs.makeDesktopItem {
                name = "aether";
                exec = "aether";
                desktopName = "Aether";
                comment = "AI-driven OSINT analyst with a live knowledge graph";
                categories = [ "Network" "Security" ];
              })
            ];

            meta = with lib; {
              description = "An AI-driven OSINT analyst that lives on your desktop";
              homepage = "https://github.com/fknMega/Aether";
              license = licenses.mit;
              platforms = platforms.linux;
              mainProgram = "aether";
            };
          };
        });
    };
}
