# Privacy and data

This is a private single-user application.

- Wardrobe and reference images are stored in a private directory on the
  owner's Hostinger server, outside `public_html` and the deployed build.
- The reference photograph can be supplied by uploading a file or by capturing a
  self-portrait with the device camera. The camera stream stays in the browser;
  only the still frame the owner confirms is uploaded to private storage.
- Images required for analysis or generation are sent to the OpenAI API.
- The reference photograph is never served back to the browser after upload.
- Outfit suggestions are calculated locally from saved categories and colours;
  browsing or selecting a suggestion sends nothing to OpenAI.
- A reference photo and selected cutouts are sent to OpenAI only after the owner
  explicitly starts an outfit try-on.
- A real photograph added through **Add my real photo** is sanitized and stored
  on the private server but is not sent to OpenAI.
- There is no analytics, advertising, behavioural tracking, public gallery or
  multi-user sharing.
- Wardrobe exports contain application data, not environment secrets.

The settings panel can replace or delete the reference photograph, download a
metadata export, clean old jobs, delete the entire wardrobe, and show the
application's request-count estimate. Item deletion removes its generated
files; a modeled photograph can be deleted while retaining the garment.
Generated try-ons and real wearing photos are stored in the same private
Hostinger directory and can be removed individually from Outfit Studio or the
selected garment.

Backups leaving Hostinger must be encrypted. See
[backup and restore](backup-and-restore.md).
