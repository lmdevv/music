# NixOS module for the `music` CLI. A host that runs services.music gets it already pointed at
# that server; any other machine that talks to the same server can install just the CLI:
#
#   programs.music = {
#     enable = true;
#     server = "https://music.example.com/convex";
#   };
#
# Each user still runs `music login` once (or sets MUSIC_API_KEY), so no key enters the Nix store.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.music;
in
{
  options.programs.music = {
    enable = lib.mkEnableOption "the [music] command line";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ./cli.nix { };
      defaultText = lib.literalExpression "music.packages.\${system}.cli";
      description = "The `music` CLI package.";
    };

    server = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      defaultText = lib.literalExpression ''
        if config.services.music.enable then "''${config.services.music.publicUrl}/convex" else null
      '';
      example = "https://music.example.com/convex";
      description = ''
        The server's Convex URL, exported to every user as `MUSIC_SERVER`, so `music login` needs
        no `--server`. It overrides the server saved by `music login`, and a saved key is sent to
        it, so leave it unset on machines that use more than one server. A plain `http://` URL to
        another machine is refused unless `MUSIC_INSECURE` is set too.
      '';
    };
  };

  config = lib.mkMerge [
    (lib.mkIf cfg.enable {
      environment = {
        systemPackages = [ cfg.package ];
        sessionVariables = lib.mkIf (cfg.server != null) { MUSIC_SERVER = cfg.server; };
      };
    })

    (lib.mkIf config.services.music.enable {
      programs.music = {
        enable = lib.mkDefault true;
        server = lib.mkDefault "${config.services.music.publicUrl}/convex";
      };
    })
  ];
}
