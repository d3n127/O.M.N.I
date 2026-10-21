# O.M.N.I (Express + EJS + MySQL)

## Open in VS Code
File > Open Folder > choose the `fourloop` folder.

## Run (3 steps, in the VS Code terminal)
1. `npm install`
2. Open `conn.js` and set your MySQL password (XAMPP default = empty). Start MySQL.
3. `npm run setup`   (creates the database + demo data; it resets the data every time)
4. `npm start`  ->  open http://localhost:3000

Tip: press F5 to start with the debugger, or Ctrl+Shift+P > "Tasks: Run Task".

## Logins (password: `password`)
- Student: 
- Admin:   

## Folders
- routes/student, routes/admin  - server code for each portal
- views/student, views/admin, views/shared  - EJS pages
- public/css, public/js  - shared / student / admin styles and scripts
