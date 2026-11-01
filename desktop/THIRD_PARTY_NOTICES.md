# Third-party notices

Render to Film for desktop (macOS on Apple silicon, Windows x64) ships some third-party software and can fetch two more tools at the user's request. Each one keeps its own licence, listed here.

ArtCraft is not included. This app contains no ArtCraft code and does not depend on it. The ArtCraft name, wordmark and logos are trademarks of their owner, the ArtCraft Team, and no licence here covers them. The name appears in this file only because the FilmCraft and LightCraft notices below reproduce it to state their origin.

## FilmCraft

FilmCraft 0.15.0, an open-source nonlinear video editor from <https://github.com/storytold/filmcraft>. This app drives its command-line tool, `filmcraft-cli`.

- Not bundled. It is detected on the computer, or downloaded when the user asks, from the project's GitHub release at a pinned version and sha256 (`desktop/platform/sidecars.js`). The app works without it.
- Licences offered: the MIT License or the Apache License, Version 2.0, at the recipient's option.
- Licence elected by this app: **Apache License, Version 2.0** (<https://www.apache.org/licenses/LICENSE-2.0.txt>).
- Each release archive carries `LICENSE-APACHE`, `LICENSE-MIT` and `NOTICE`, and a download keeps them beside the binary.

The project's NOTICE, copied unchanged from <https://github.com/storytold/filmcraft/blob/v0.15.0/NOTICE>:

```text
FilmCraft
Copyright (c) 2026 ArtCraft Team and the FilmCraft contributors.
Licensed under the MIT License or the Apache License, Version 2.0, at your option
(LICENSE-MIT, LICENSE-APACHE).

The ArtCraft name, wordmark and logos in docs/brand/ are trademarks of the ArtCraft Team. They are
not open source and are not covered by the license above; their terms are in
docs/brand/LICENSE-brand.txt.

Third-party material

This product bundles third-party material under its own licenses, listed below. The per-file
list (author, source, license) is in ATTRIBUTION.md.

Inter font (assets/fonts/Inter-*.ttf) — OFL-1.1. See assets/fonts/OFL-Inter.txt.
Noto Serif font (assets/fonts/NotoSerif-Regular.ttf) — OFL-1.1. See assets/fonts/OFL-NotoSerif.txt.
JetBrains Mono font (assets/fonts/JetBrainsMono-Regular.ttf) — OFL-1.1. See assets/fonts/OFL-JetBrainsMono.txt.
Builds made with craft-fonts (CRAFT_FONTS_DIR; all official releases) also embed the fonts listed in
https://github.com/storytold/craft-fonts/blob/main/ATTRIBUTION.md (BIZ UDPGothic, Shippori Mincho,
BIZ UDMincho, Noto Sans CJK SC, Noto Sans Arabic, Noto Sans Thai, Noto Sans Georgian) — OFL-1.1. Their licence texts ship with the packages as OFL-<family>.txt.
Public-domain film and NASA frames and CC0 music shown in README screenshots (docs/images/) — public domain / CC0-1.0. See ATTRIBUTION.md.


egui icon font subset (dependency asset)
----------------------------------------
epaint_default_fonts 0.37 embeds egui-icons.ttf, a five-glyph subset of
emoji-icon-font by John Slegers. The full monochrome emoji-icon-font fallback
uses the same MIT license. Upstream license text follows unchanged.

MIT License

Copyright (c) 2014 John Slegers

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Noto Emoji font (dependency asset)
----------------------------------
epaint_default_fonts 0.37, pinned with egui 0.37 at
https://github.com/storytold/egui/tree/6d518fc799681571963842f95b55a6b68431b15a/crates/epaint_default_fonts/fonts,
embeds NotoEmoji-Regular.ttf, the monochrome emoji fallback used when egui's
`monochrome_emoji_fonts` feature is enabled. The font's copyright notice and the
upstream SIL Open Font License 1.1 text follow unchanged.

Copyright 2013 Google Inc. All Rights Reserved.

This Font Software is licensed under the SIL Open Font License,
Version 1.1.

This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font
creation efforts of academic and linguistic communities, and to
provide a free and open framework in which fonts may be shared and
improved in partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply to
any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software
components as distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to,
deleting, or substituting -- in part or in whole -- any of the
components of the Original Version, by changing formats or by porting
the Font Software to a new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed,
modify, redistribute, and sell modified and unmodified copies of the
Font Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components, in
Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the
corresponding Copyright Holder. This restriction only applies to the
primary font name as presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created using
the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.

Ubuntu Light font (dependency asset)
------------------------------------
epaint_default_fonts 0.37, pinned with egui 0.37 at
https://github.com/storytold/egui/tree/6d518fc799681571963842f95b55a6b68431b15a/crates/epaint_default_fonts/fonts,
embeds Ubuntu-Light.ttf as a default fallback. The font's copyright notice and the
upstream Ubuntu Font Licence 1.0 text follow unchanged.

Copyright 2011 Canonical Ltd.  Licensed under the Ubuntu Font Licence 1.0

-------------------------------
UBUNTU FONT LICENCE Version 1.0
-------------------------------

PREAMBLE
This licence allows the licensed fonts to be used, studied, modified and
redistributed freely. The fonts, including any derivative works, can be
bundled, embedded, and redistributed provided the terms of this licence
are met. The fonts and derivatives, however, cannot be released under
any other licence. The requirement for fonts to remain under this
licence does not require any document created using the fonts or their
derivatives to be published under this licence, as long as the primary
purpose of the document is not to be a vehicle for the distribution of
the fonts.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this licence and clearly marked as such. This may
include source files, build scripts and documentation.

"Original Version" refers to the collection of Font Software components
as received under this licence.

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to
a new environment.

"Copyright Holder(s)" refers to all individuals and companies who have a
copyright ownership of the Font Software.

"Substantially Changed" refers to Modified Versions which can be easily
identified as dissimilar to the Font Software by users of the Font
Software comparing the Original Version with the Modified Version.

To "Propagate" a work means to do anything with it that, without
permission, would make you directly or secondarily liable for
infringement under applicable copyright law, except executing it on a
computer or modifying a private copy. Propagation includes copying,
distribution (with or without modification and with or without charging
a redistribution fee), making available to the public, and in some
countries other activities as well.

PERMISSION & CONDITIONS
This licence does not grant any rights under trademark law and all such
rights are reserved.

Permission is hereby granted, free of charge, to any person obtaining a
copy of the Font Software, to propagate the Font Software, subject to
the below conditions:

1) Each copy of the Font Software must contain the above copyright
notice and this licence. These can be included either as stand-alone
text files, human-readable headers or in the appropriate machine-
readable metadata fields within text or binary files as long as those
fields can be easily viewed by the user.

2) The font name complies with the following:
(a) The Original Version must retain its name, unmodified.
(b) Modified Versions which are Substantially Changed must be renamed to
avoid use of the name of the Original Version or similar names entirely.
(c) Modified Versions which are not Substantially Changed must be
renamed to both (i) retain the name of the Original Version and (ii) add
additional naming elements to distinguish the Modified Version from the
Original Version. The name of such Modified Versions must be the name of
the Original Version, with "derivative X" where X represents the name of
the new work, appended to that name.

3) The name(s) of the Copyright Holder(s) and any contributor to the
Font Software shall not be used to promote, endorse or advertise any
Modified Version, except (i) as required by this licence, (ii) to
acknowledge the contribution(s) of the Copyright Holder(s) or (iii) with
their explicit written permission.

4) The Font Software, modified or unmodified, in part or in whole, must
be distributed entirely under this licence, and must not be distributed
under any other licence. The requirement for fonts to remain under this
licence does not affect any document created using the Font Software,
except any version of the Font Software extracted from a document
created using the Font Software may only be distributed under this
licence.

TERMINATION
This licence becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER
DEALINGS IN THE FONT SOFTWARE.

Hack font (dependency asset)
----------------------------
epaint_default_fonts 0.37, pinned with egui 0.37 at
https://github.com/storytold/egui/tree/6d518fc799681571963842f95b55a6b68431b15a/crates/epaint_default_fonts/fonts,
embeds Hack-Regular.ttf as the default monospace fallback. The upstream notice and
licences follow unchanged.

The work in the Hack project is Copyright 2018 Source Foundry Authors and licensed under the MIT License

The work in the DejaVu project was committed to the public domain.

Bitstream Vera Sans Mono Copyright 2003 Bitstream Inc. and licensed under the Bitstream Vera License with Reserved Font Names "Bitstream" and "Vera"
MIT License

Copyright (c) 2018 Source Foundry Authors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
BITSTREAM VERA LICENSE

Copyright (c) 2003 by Bitstream, Inc. All Rights Reserved. Bitstream Vera is a trademark of Bitstream, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of the fonts accompanying this license ("Fonts") and associated documentation files (the "Font Software"), to reproduce and distribute the Font Software, including without limitation the rights to use, copy, merge, publish, distribute, and/or sell copies of the Font Software, and to permit persons to whom the Font Software is furnished to do so, subject to the following conditions:

The above copyright and trademark notices and this permission notice shall be included in all copies of one or more of the Font Software typefaces.

The Font Software may be modified, altered, or added to, and in particular the designs of glyphs or characters in the Fonts may be modified and additional glyphs or characters may be added to the Fonts, only if the fonts are renamed to names not containing either the words "Bitstream" or the word "Vera".

This License becomes null and void to the extent applicable to Fonts or Font Software that has been modified and is distributed under the "Bitstream Vera" names.

The Font Software may be sold as part of a larger software package but no copy of one or more of the Font Software typefaces may be sold by itself.

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL BITSTREAM OR THE GNOME FOUNDATION BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE FONT SOFTWARE.

Except as contained in this notice, the names of Gnome, the Gnome Foundation, and Bitstream Inc., shall not be used in advertising or otherwise to promote the sale, use or other dealings in this Font Software without prior written authorization from the Gnome Foundation or Bitstream Inc., respectively. For further information, contact: fonts at gnome dot org.
```

## LightCraft

LightCraft 0.16.0, an open-source non-destructive photo editor from <https://github.com/storytold/lightcraft>. This app drives its command-line tool, `lightcraft-cli`.

- Not bundled. It is detected on the computer, or downloaded when the user asks, from the project's GitHub release at a pinned version and sha256 (`desktop/platform/sidecars.js`). The app works without it.
- Licences offered: the MIT License or the Apache License, Version 2.0, at the recipient's option. Its NOTICE states the part that is Apache-2.0 only.
- Licence elected by this app: **Apache License, Version 2.0** (<https://www.apache.org/licenses/LICENSE-2.0.txt>).
- Each release archive carries `LICENSE-APACHE`, `LICENSE-MIT` and `NOTICE`, and a download keeps them beside the binary.

The project's NOTICE, copied unchanged from <https://github.com/storytold/lightcraft/blob/v0.16.0/NOTICE>:

```text
LightCraft
Copyright (c) 2026 ArtCraft Team and the LightCraft contributors.
Licensed under the MIT License or the Apache License, Version 2.0, at your option
(LICENSE-MIT, LICENSE-APACHE).

The ArtCraft name, wordmark and logos in docs/brand/ are trademarks of the ArtCraft Team. They are
not open source and are not covered by the license above; their terms are in
docs/brand/LICENSE-brand.txt.

Third-party material

This product bundles third-party material under its own licenses, listed below. The per-file
list (author, source, license) is in assets/ATTRIBUTION.md.

Inter (assets/fonts/Inter-*.ttf) — SIL Open Font License 1.1. The licence text is
assets/fonts/OFL-Inter.txt in the source tree; release packages ship it beside NOTICE as
OFL-Inter.txt (Windows installers include it in FONT-LICENCES.txt).
Showcase photographs by Ansel Adams, Dorothea Lange and NASA (docs/images/) — public domain. See assets/ATTRIBUTION.md.

crates/raw/src/spectral_table.rs (lightcraft-raw) holds camera colour matrices derived from the
camera spectral sensitivities, training reflectances and model alias list of rawtoaces-data
(https://github.com/AcademySoftwareFoundation/rawtoaces-data, v1.1.0), an Academy Software
Foundation project licensed under the Apache License 2.0, and from the CIE 1931 colour-matching
functions it ships (CIE, CC-BY-4.0). The matrices were fitted by the LightCraft contributors
(2026) with tools/spectral_camera_table.py. See assets/ATTRIBUTION.md.

crates/inpaint (lightcraft-inpaint) ports the inpainting (PatchMatch completion) and Poisson membrane
fill code of PhotoCraft (https://github.com/storytold/photocraft, crates/algo/src/inpaint.rs and
poisson.rs), Copyright the PhotoCraft contributors, licensed under the MIT License or the Apache
License 2.0, at your option. The port was modified by the LightCraft contributors (2026); each
ported file says so.

crates/segment (lightcraft-segment) ports the SAM 3 model code of Hugging Face Transformers
(https://github.com/huggingface/transformers, src/transformers/models/sam3 and sam3_tracker),
Copyright The HuggingFace Team and Meta Platforms, Inc., licensed under the Apache License 2.0.
The port was modified by the LightCraft contributors (2026): translated from Python/PyTorch to
Rust on candle and restructured; each ported file says so. Because of this, crates/segment is
licensed under the Apache License 2.0 only (LICENSE-APACHE), not under the MIT option.

The SAM 3 weights are not part of LightCraft and are never distributed with it. A user downloads
the facebook/sam3 checkpoint only when they choose to (in the app, or by hand), under Meta's SAM
License (https://github.com/facebookresearch/sam3/blob/main/LICENSE), a separate, non-OSI
licence. See docs/ai-masks.md.

AI denoise weights are not part of LightCraft and are never distributed with it.
The default build offers user-supplied models only. The optional rawnind-model
feature offers a separately downloaded RawNIND UtNet2 Bayer checkpoint under
GPL-3.0 (https://www.gnu.org/licenses/gpl-3.0.html), after the user accepts its terms.
Commercial use is subject to those terms, including applicable source, licence and
notice obligations on redistribution. Enabling that offer in releases remains a
maintainer decision. The ONNX reader and CPU/GPU executor are our Rust implementation;
no darktable, RawSpeed, LibRaw or other GPL decoder/runtime code is included.

Builds made with craft-fonts (the optional CRAFT_FONTS_DIR build input; all official releases)
also embed the default fonts listed in
https://github.com/storytold/craft-fonts/blob/b076417b5880bd4154bd22f00695b1d28c6bea83/ATTRIBUTION.md (BIZ UDPGothic, BIZ UDMincho,
Shippori Mincho, Noto Sans CJK SC, Noto Sans Arabic, Noto Sans Thai, Noto Sans Georgian,
NanumGothic, Noto Sans Symbols, Noto Sans Symbols 2, Noto Sans Hebrew and
Noto Sans Devanagari), under the SIL Open Font License 1.1. The opt-in LXGW WenKai Lite face
(fonts/simplified-chinese-manifest.txt in craft-fonts) is not embedded. The web build embeds
BIZ UDPGothic Regular, Noto Sans Thai Regular and Noto Sans Georgian Regular, and loads Noto Sans
CJK SC separately. Release packages include each font's licence as OFL-<family>.txt; Windows
installers include their texts in FONT-LICENCES.txt.

Place names for reverse geocoding (Photo > Fill Location from GPS) are not part of LightCraft and
are never distributed with it. On the user's request (Photo > Download Place Names) the app
downloads cities15000.zip, admin1CodesASCII.txt and countryInfo.txt from GeoNames
(https://download.geonames.org/export/dump/) into the settings folder. GeoNames data is licensed
under Creative Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/);
attribution: "GeoNames, geonames.org". The lookup code (crates/geocode) is our own.


epaint_default_fonts, the egui default-font crate LightCraft builds with, also bundles Hack Regular
and Ubuntu Light, and Noto Emoji Regular when egui's `monochrome_emoji_fonts` feature is on (the
LightCraft workspace enables both `default_fonts` and `monochrome_emoji_fonts` on egui 0.37). The
LightCraft binaries embed these faces unmodified, registered through egui's default font definitions.
Source for all of them (the same pin as the icon fonts below):
https://github.com/storytold/egui/tree/6d518fc799681571963842f95b55a6b68431b15a/crates/epaint_default_fonts/fonts

Hack Regular (Hack-Regular.ttf) is Copyright (c) 2018 Source Foundry Authors and
Copyright (c) 2003 by Bitstream, Inc. All Rights Reserved. It is licensed under the MIT License, and
the Bitstream Vera parts under the Bitstream Vera License with Reserved Font Names "Bitstream" and
"Vera": the font as a whole is MIT AND Bitstream Vera License. The work in the DejaVu project it
derives from was committed to the public domain.
The following text is reproduced verbatim from Hack-Regular.txt:

The work in the Hack project is Copyright 2018 Source Foundry Authors and licensed under the MIT License

The work in the DejaVu project was committed to the public domain.

Bitstream Vera Sans Mono Copyright 2003 Bitstream Inc. and licensed under the Bitstream Vera License with Reserved Font Names "Bitstream" and "Vera"
MIT License

Copyright (c) 2018 Source Foundry Authors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
BITSTREAM VERA LICENSE

Copyright (c) 2003 by Bitstream, Inc. All Rights Reserved. Bitstream Vera is a trademark of Bitstream, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of the fonts accompanying this license ("Fonts") and associated documentation files (the "Font Software"), to reproduce and distribute the Font Software, including without limitation the rights to use, copy, merge, publish, distribute, and/or sell copies of the Font Software, and to permit persons to whom the Font Software is furnished to do so, subject to the following conditions:

The above copyright and trademark notices and this permission notice shall be included in all copies of one or more of the Font Software typefaces.

The Font Software may be modified, altered, or added to, and in particular the designs of glyphs or characters in the Fonts may be modified and additional glyphs or characters may be added to the Fonts, only if the fonts are renamed to names not containing either the words "Bitstream" or the word "Vera".

This License becomes null and void to the extent applicable to Fonts or Font Software that has been modified and is distributed under the "Bitstream Vera" names.

The Font Software may be sold as part of a larger software package but no copy of one or more of the Font Software typefaces may be sold by itself.

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL BITSTREAM OR THE GNOME FOUNDATION BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE FONT SOFTWARE.

Except as contained in this notice, the names of Gnome, the Gnome Foundation, and Bitstream Inc., shall not be used in advertising or otherwise to promote the sale, use or other dealings in this Font Software without prior written authorization from the Gnome Foundation or Bitstream Inc., respectively. For further information, contact: fonts at gnome dot org.


Ubuntu Light (Ubuntu-Light.ttf) is Copyright 2011 Canonical Ltd., was designed by Dalton Maag Ltd,
and is licensed under the Ubuntu Font Licence 1.0 (not the SIL Open Font License).
The following text is reproduced verbatim from UFL.txt; that file carries no copyright line, so the
copyright notice above is taken from the font's own name table:

-------------------------------
UBUNTU FONT LICENCE Version 1.0
-------------------------------

PREAMBLE
This licence allows the licensed fonts to be used, studied, modified and
redistributed freely. The fonts, including any derivative works, can be
bundled, embedded, and redistributed provided the terms of this licence
are met. The fonts and derivatives, however, cannot be released under
any other licence. The requirement for fonts to remain under this
licence does not require any document created using the fonts or their
derivatives to be published under this licence, as long as the primary
purpose of the document is not to be a vehicle for the distribution of
the fonts.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this licence and clearly marked as such. This may
include source files, build scripts and documentation.

"Original Version" refers to the collection of Font Software components
as received under this licence.

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to
a new environment.

"Copyright Holder(s)" refers to all individuals and companies who have a
copyright ownership of the Font Software.

"Substantially Changed" refers to Modified Versions which can be easily
identified as dissimilar to the Font Software by users of the Font
Software comparing the Original Version with the Modified Version.

To "Propagate" a work means to do anything with it that, without
permission, would make you directly or secondarily liable for
infringement under applicable copyright law, except executing it on a
computer or modifying a private copy. Propagation includes copying,
distribution (with or without modification and with or without charging
a redistribution fee), making available to the public, and in some
countries other activities as well.

PERMISSION & CONDITIONS
This licence does not grant any rights under trademark law and all such
rights are reserved.

Permission is hereby granted, free of charge, to any person obtaining a
copy of the Font Software, to propagate the Font Software, subject to
the below conditions:

1) Each copy of the Font Software must contain the above copyright
notice and this licence. These can be included either as stand-alone
text files, human-readable headers or in the appropriate machine-
readable metadata fields within text or binary files as long as those
fields can be easily viewed by the user.

2) The font name complies with the following:
(a) The Original Version must retain its name, unmodified.
(b) Modified Versions which are Substantially Changed must be renamed to
avoid use of the name of the Original Version or similar names entirely.
(c) Modified Versions which are not Substantially Changed must be
renamed to both (i) retain the name of the Original Version and (ii) add
additional naming elements to distinguish the Modified Version from the
Original Version. The name of such Modified Versions must be the name of
the Original Version, with "derivative X" where X represents the name of
the new work, appended to that name.

3) The name(s) of the Copyright Holder(s) and any contributor to the
Font Software shall not be used to promote, endorse or advertise any
Modified Version, except (i) as required by this licence, (ii) to
acknowledge the contribution(s) of the Copyright Holder(s) or (iii) with
their explicit written permission.

4) The Font Software, modified or unmodified, in part or in whole, must
be distributed entirely under this licence, and must not be distributed
under any other licence. The requirement for fonts to remain under this
licence does not affect any document created using the Font Software,
except any version of the Font Software extracted from a document
created using the Font Software may only be distributed under this
licence.

TERMINATION
This licence becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER
DEALINGS IN THE FONT SOFTWARE.


Noto Emoji Regular (NotoEmoji-Regular.ttf) is Copyright 2013 Google Inc. All Rights Reserved. It was
designed by the Monotype Design Team and is licensed under the SIL Open Font License 1.1.
The following text is reproduced verbatim from OFL.txt; that file carries no copyright line, so the
copyright notice above is taken from the font's own name table:

This Font Software is licensed under the SIL Open Font License,
Version 1.1.

This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font
creation efforts of academic and linguistic communities, and to
provide a free and open framework in which fonts may be shared and
improved in partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply to
any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software
components as distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to,
deleting, or substituting -- in part or in whole -- any of the
components of the Original Version, by changing formats or by porting
the Font Software to a new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed,
modify, redistribute, and sell modified and unmodified copies of the
Font Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components, in
Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the
corresponding Copyright Holder. This restriction only applies to the
primary font name as presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created using
the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.


The UI's egui-icons.ttf subset and emoji-icon-font.ttf fallback are provided by epaint_default_fonts
and registered through egui's default font definitions. They derive from emoji-icon-font by
John Slegers, under the MIT License. The subset and full face share the following upstream notice.
Source: https://github.com/storytold/egui/tree/6d518fc799681571963842f95b55a6b68431b15a/crates/epaint_default_fonts/fonts
Original: https://github.com/jslegers/emoji-icon-font
The following text is reproduced verbatim from emoji-icon-font-mit-license.txt:

MIT License

Copyright (c) 2014 John Slegers

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## FFmpeg

FFmpeg does the app's exports, trims and frame captures. It is bundled through the `ffmpeg-static` npm package (5.3.0, declared `GPL-3.0-or-later`, <https://github.com/eugeneware/ffmpeg-static>) and runs as a separate process.

- Licence: GNU General Public License, version 3 (<https://www.gnu.org/licenses/gpl-3.0.txt>), because the build enables `--enable-gpl --enable-version3`.
- Source: <https://ffmpeg.org/download.html>, repository <https://git.ffmpeg.org/ffmpeg.git>.

**The current macOS binary cannot be redistributed.** The macOS arm64 binary from `ffmpeg-static` reports `ffmpeg version 6.0`, its configure line includes `--enable-nonfree`, and `ffmpeg -L` prints "This version of ffmpeg has nonfree parts compiled in. Therefore it is not legally redistributable." It is to be replaced by the GPL build from `.github/workflows/ffmpeg.yml` (FFmpeg 7.1.5 from the official source tarball, no `--enable-nonfree`); until then, a build carrying it is not fit for public release. `desktop/scripts/check-ffmpeg-licence.mjs` checks this at `dist` time. That check has not yet been run on the Windows x64 binary, which comes from the same package.

## libvips (`@img/sharp-libvips-*`)

The `sharp` image library (Apache-2.0) loads the prebuilt libvips from the `@img/sharp-libvips-*` packages, as a separate shared library.

- Licence: GNU Lesser General Public License, version 3 or later (`LGPL-3.0-or-later`, <https://www.gnu.org/licenses/lgpl-3.0.txt>).
- Package and build scripts: <https://github.com/lovell/sharp-libvips>.
- Source: <https://github.com/libvips/libvips>.
- Version on macOS arm64: `@img/sharp-libvips-darwin-arm64` 1.3.4, libvips 8.18.7. The package's `versions.json` lists the libraries built into it.

## Higgsfield CLI

`@higgsfield/cli` 1.2.2, bundled for the Higgsfield provider (<https://higgsfield.ai>, <https://github.com/higgsfield-ai/cli>).

- Licence: MIT, as declared in its `package.json`.
