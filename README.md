echo "# ningbgm.io" >> README.md
git init
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/ningbgm/ningbgm.io.git
git push -u origin main



git config --global --unset http.proxy
git config --global --unset https.proxy

git add .
git commit -m "second commit"
git push

git remote add origin https://github.com/7toCR/ningbgm.git


git remote add origin https://github.com/7toCR/ningbgm
git branch -M main
git push -u origin main