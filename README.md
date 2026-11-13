# Greed

A remake of the 1985 Unix terminal game *Greed*, as one self-contained web page and an Android app (phone and tablet).

## Build

    npm install            # fonts (VT323, IBM Plex Mono) from @fontsource
    python3 build.py       # -> dist/greed.html and android/assets/index.html
    node tests/game.test.mjs

    cd android
    ANDROID_JAR=/path/to/android-34.jar KEYSTORE_FILE=/path/to/greed.jks \
    KEYSTORE_PASSWORD=... KEY_ALIAS=greed ./build.sh      # -> android/Greed.apk

Needs aapt2, javac, d8 (or dalvik-exchange), zipalign and apksigner. The keystore is not part of this source.

## Layout

- `web/game.js` – the board and the rules (no drawing); also used by the tests
- `web/app.js` – screen, input, modes, statistics, achievements, CRT effects
- `web/index.html` – page and styles
- `android/` – WebView wrapper (`nl.rarevogel.greed`)
