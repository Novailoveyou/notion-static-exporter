# Algo

1. Go to given URL with puppeteer
2. Scroll down till the end
3. Collect all `<a>` tags and their `href`s, save `href`'s to que
4. Save entire page as is with all the images, fonts, styles, js
5. Go through each file using regex with matching by given url, replace that url in each static file to just "/" so that all paths to static resources are relative
6. Repeat that process for all saved `<a>` tags until no saved urls remaining