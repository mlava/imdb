This extension allows you to search and import metadata for films or tv series from the IMDb. 

**New:**
- fallback to search by IMDb id if the title search doesn't find the correct title. Simply choose 'None of these titles!' in the select menu, then add the IMDb id in the next popup. The IMDb id is in the URL:
  - For Back to the Future, the url is: https://www.imdb.com/title/tt0088763/
  - the IMDb id is the tt0088763 string
- get Ratings from IMDb, Rotten Tomatoes and Metacritic if they are available.

You will need to get an API key from [omdbapi.com](http://www.omdbapi.com/apikey.aspx) and insert it in the Roam Depot configuration panel.

You can trigger the extension via the Command Palette or via SmartBlocks using <%IMDB%>.

The extension will retrieve the page title, search IMDb for that title and then present a list of matching films or tv series. After you select one, it will import the poster and metadata, formatted nicely using Roam Research conventions.

https://www.loom.com/share/8ef29241dd8247099fc0353888e8f3bc

With thanks to @dvargas92495 https://github.com/dvargas92495 for his help generating the modal select configuration!

After feedback, this extension has been updated to allow configuration of the headings for the director, writer, cast, year and genre headings, as well as to have optional output using Roam Research attributes. Thanks @8bitgentleman!
