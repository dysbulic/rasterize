# Rasterizer

This is a simple node.js script that captures `--iters` frames of the page at `--url`. The dimensions default to 200⨯200, but can be set with `-h` & `-w`.

In order to run, a headless server needs to be running. To start Chrome headless on Ubuntu, use: `google-chrome --headless --remote-debugging-port=9222 file://`.

## Help

```bash
$ node index.js --help
Options:
    --version  Show version number                     [boolean]
-i, --iters    Number of iterations                     [number]
-u, --url      URL to load [required]                   [string]
-p, --prefix   Image filename prefix [default "shot"]   [string]
-w, --width    Width to render [default 200]            [number]
-h, --height   Height to render [default 200]           [number]
    --help     Show help                               [boolean]
```