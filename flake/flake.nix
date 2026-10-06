{
  description = "Cooking Timer Obsidian plugin dev shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      devShells = forAllSystems (pkgs: {
        # Node >= 22.18 is required: `npm test` relies on native TypeScript type stripping.
        # nodejs_22 ships npm, which drives build/lint/test via package.json scripts.
        default = pkgs.mkShell {
          name = "cooking-timer";
          packages = [ pkgs.nodejs_22 ];
        };
      });
    };
}
