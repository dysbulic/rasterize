# Rasterizer

This is a simple node.js script that captures `--iters` frames of the page at `--url`. The dimensions default to 200⨯200, but can be set with `-h` & `-w`.

In order to run, a headless server needs to be running. To start Chrome on Ubuntu, use: `google-chrome --headless --remote-debugging-port=9222 file://`.