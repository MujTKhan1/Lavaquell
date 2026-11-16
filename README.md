# Lavaquell by AirOWater: landing page concept

A single-page landing concept built from the content and assets on airowaterglobal.com. The hero follows a supplied composition reference. The section-two reveal is modelled on sofihealth.com, where a product rises into a centred composition and turns while short callouts appear around it.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
```

## Page structure
1. **Hero:** a static image cropped from the supplied composition reference (`public/assets/hero-scene.webp`). The headline, copy and buttons are live HTML. Hero animation is planned for later; the earlier animated version is kept unused in `src/three/productHero.js` and `wave.js`.
2. **Reveal:** the supplied GLB bottle rises through a calm pool, turns once, and settles label-forward. It's pinned for 210vh, and its progress counts only from when this section reaches the top of the screen.
3. **Collection**, 4. **Our Cycle**, 5. **Partner With Us**: unchanged.

## Bottle model (section two)
`public/models/lavaquell-bottle-real.glb` is the real-shape Lavaquell bottle, built in Blender by `render/lavaquell_scene.py`. Re-export it with:

    blender -b -P render/lavaquell_scene.py -- --mode glb

- **Shape:** the silhouette is traced from the official product photo: tall straight body, long conical shoulder and short neck ring.
- **Glass:** a closed solid with real wall thickness and a thick base.
- **Water:** a separate volume filled to the shoulder.
- **Cap:** a knurled silver screw cap.
- **Print:** `public/models/lavaquell-print.png`, made from the real logo files by `render/make_label.py`. It's applied in the browser, because the glTF exporter can't carry Blender's print shader.

How it's loaded (`src/three/glbBottle.js`):
- The water keeps its real IOR (1.333) and gets a pale aqua tint. A level water line lags the bottle's tilt on a spring.
- The glass keeps its IOR but is drawn as a reflective shell that darkens towards its edges. Three.js can't show one refracting object through another, so this is a browser approximation: it won't match the Blender render's realism.
- Lighting is a studio environment with strip highlights, a back rim light and an aqua bounce from the pool.
- The GLB is 3.5 MB, mostly glass geometry. Lowering the segment count before export, or compressing it, would cut this a lot before launch.

The same Blender scene can also render a photoreal frame sequence (`--mode anim`). That render was stopped at 54 of 150 frames. The partial frames and the old frame player are kept in `render/unused/`; the old stock GLB is there too.

## Hero image caveat
The hero image is the composition reference you supplied. Its packaging (mountain-style logo marks, wave graphics on the cans and bottle, ribbed glass) is generated artwork, not Lavaquell's actual packaging as shown on airowaterglobal.com. Its resolution (937 × 862 after cropping) is also below what a large retina display needs. Replace it with a real product render or photograph at about 2× display size before launch.

## Conflicts and gaps found on the source site
- **Partner names:** the homepage strip lists Shangri-La, Fairmont, The Oberoi, Raffles, InterContinental, Grosvenor House, Aman, Hilton, Hyatt, Marriott, Four Seasons and Rotana. The *partners.png* logo collage shows a different set (DMCC, Taj, Accor, Ennismore, Swissôtel, Ramada, Danat, Bahi and others). Aman, Hilton, Hyatt, Four Seasons and Rotana appear only in the text strip. The page uses the text strip; the brand should confirm the list.
- **Sparkling print colour:** the Sparkling glass bottle and can are printed in **green**, not blue. The hero's Sparkling bottle and can keep this green.
- **AirOWater aluminium bottle:** it is listed as "Premium Air Water", but the label in the photo reads "STILL WATER".
- **Aluminium bottle sizes:** both Lavaquell Still and AirOWater aluminium bottles are listed as 250/500/600 ml, but the photos show only 500 ml and 600 ml.
- **"Coming Soon":** removed from both cans as requested. No availability claim was added.
- **Figures:** the page now uses only capacities (250–1000 ml), the GSO 1025/2014 standard, and certifications that appear on the site. The facility size, the 20M+ bottles figure and the temperature range were dropped along with the sections that held them.
- **Enquiry form:** the live site sends enquiries through EmailJS, and its keys aren't available. This concept opens the visitor's email app with the enquiry addressed to info@airowaterglobal.com. Before launch, connect it to the brand's real form backend.
- **Product pages:** the site has no separate product detail pages; "View Details" only expands cards. All navigation stays on this page.
