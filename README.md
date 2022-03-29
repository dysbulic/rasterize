# Rasterizer

This is a simple node.js script that captures `--iters` frames of the page at `--url`. The dimensions default to 200⨯200, but can be set with `-h` & `-w`.

In order to run, a headless server needs to be running. To start Chrome headless on Ubuntu, use: `google-chrome --headless --remote-debugging-port=9222 file://`.

## Help

```bash
$ ./rasterizer --help
Options:
    --version  Show version number                        [boolean]
-i, --iters    Number of iterations                        [number]
-u, --url      URL to load [required]                      [string]
-p, --prefix   Image filename prefix [default "shot"]      [string]
-w, --width    Width to render [default 200]               [number]
-h, --height   Height to render [default 200]              [number]
-d, --drop     Frames to drop between captures [defualt 0] [number]
    --help     Show help                                  [boolean]
```

# Simplify

Another node.js script which loads a SVG and feeds all of its <path/>s to [Paper.js](//paperjs.org/)’s [simplify](//paperjs.org/reference/path/#simplify) method. It should
significantly reduce the number of points in many curves.

Unfortunately, as of this writing (March 2022), it doesn't work. The program performs
as expected, but the resultant SVG is full of errors. I raised [an issue](//github.com/paperjs/paper.js/issues/1970), and we'll see if anything comes of it.

## Help

```bash
$ ./simplify --help
simplify [files..]

This program uses paper.js to reduce the number of points in an SVG’s <path/>s.

Options:
      --version    Show version number         [boolean]
  -t, --tolerance                          [default: 10]
  -h, --help       Show help                   [boolean]
      --files                                 [required]
```