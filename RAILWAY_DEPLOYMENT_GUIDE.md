# Deployment Guide for Railway

This guide will help you deploy your Pharmacy Management System to Railway.

## Prerequisites

1. A Railway account (sign up at [railway.app](https://railway.app))
2. Your code pushed to a Git repository (GitHub, GitLab, or Bitbucket)

## Deployment Steps

### 1. Prepare Your Application

Your application has been prepared for Railway deployment with:
- A `Procfile` that tells Railway how to start your application
- A `railway.json` configuration file
- A `Dockerfile` for containerized deployment
- Updated code to use environment variables for port and secrets
- A `.gitignore` file to exclude sensitive files

### 2. Deploy to Railway

#### Option A: Using the Railway Dashboard

1. Go to [railway.app](https://railway.app) and sign in
2. Click "New Project"
3. Choose "Deploy from GitHub/GitLab/Bitbucket"
4. Select your repository containing this code
5. Select the branch you want to deploy (usually `main` or `master`)
6. Click "Deploy"

#### Option B: Using the Railway CLI

1. Install the Railway CLI: `npm install -g @railway/cli`
2. Login: `railway login`
3. Link your project: `railway link`
4. Deploy: `railway deploy`

### 3. Configure Environment Variables

After deployment, you'll need to set the following environment variables in your Railway dashboard:

1. Go to your project in the Railway dashboard
2. Navigate to the "Variables" section
3. Add these variables:

```
JWT_SECRET=your_very_secure_jwt_secret_here
DATABASE_URL=/app/pharmacy.db
```

### 4. Enable SQLite Persistence (Important!)

Since this application uses SQLite, which stores data in a file, you need to enable persistence so your data isn't lost when the container restarts:

1. In your Railway dashboard, go to the "Volumes" section
2. Create a new volume and attach it to your service
3. This will persist your SQLite database file

Alternatively, you can connect to a PostgreSQL database for better performance and reliability.

### 5. Access Your Application

After a successful deployment, Railway will provide a URL where your application is accessible. It will typically look like:

```
https://your-project-name-production.up.railway.app
```

### 6. Update API URL in Frontend

Once deployed, you'll need to update the API URL in your frontend application:

1. Open `index_sqlite.html` in your code
2. Find the API URL configuration section
3. Change it from `http://localhost:3000/api` to your Railway deployment URL
4. Redeploy if you make changes

## Important Notes

1. **Database File Location**: The application expects to find the SQLite database at `pharmacy.db`. Make sure the location is persistent across deployments.

2. **Security**: Change the default JWT secret in the environment variables after deployment.

3. **Performance**: For production use, consider migrating from SQLite to PostgreSQL for better performance and concurrency.

4. **Backups**: Regularly backup your database file to prevent data loss.

## Troubleshooting

If you encounter issues:

1. Check the logs in the Railway dashboard under the "Logs" section
2. Verify that all environment variables are correctly set
3. Ensure your database file path is correctly configured and persistent
4. Confirm that the port is being read from the `PORT` environment variable

## Updating Your Application

When you want to update your application:

1. Make changes to your code
2. Commit and push to your Git repository
3. Railway will automatically deploy the changes if you have that setting enabled
4. Or manually trigger a deployment in the Railway dashboard