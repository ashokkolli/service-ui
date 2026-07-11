/*
 * Copyright 2024 EPAM Systems
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const path = require('path');
const dotenv = require('dotenv');
const CircularDependencyPlugin = require('circular-dependency-plugin');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');

dotenv.config();

module.exports = () => {
  if (!process.env.PROXY_PATH) {
    // eslint-disable-next-line no-console
    console.log('========== Specify the PROXY_PATH variable in the .env file =========');
    process.exit(1);
  }
  return {
    devtool: 'eval-source-map',
    mode: 'development',
    output: {
      publicPath: '/',
    },
    module: {
      rules: [
        {
          test: /\.css$/,
          include: /node_modules/,
          use: [
            // see https://github.com/webpack-contrib/css-loader?tab=readme-ov-file#recommend
            'style-loader',
            'css-loader',
          ],
        },
        {
          test: /\.(sa|sc)ss$/,
          exclude: /node_modules/,
          use: [
            'style-loader',
            {
              loader: 'css-loader',
              options: {
                modules: {
                  namedExport: false,
                  exportLocalsConvention: 'as-is',
                  localIdentName: '[name]__[local]--[contenthash:base64:5]',
                },
                importLoaders: 1,
              },
            },
            'sass-loader',
            {
              loader: 'sass-resources-loader',
              options: {
                resources: path.resolve(__dirname, '../src/common/css/variables/**/*.scss'),
              },
            },
          ],
        },
      ],
    },
    optimization: {
      runtimeChunk: 'single',
    },
    plugins: [
      new CircularDependencyPlugin({
        exclude: /node_modules|gridBody/,
        failOnError: false,
        allowAsyncCycles: false,
        cwd: process.cwd(),
      }),
      new ReactRefreshWebpackPlugin(),
    ],
    devServer: {
      static: {
        directory: path.resolve(__dirname, '../build'),
      },
      hot: true,
      historyApiFallback: true,
      host: '0.0.0.0',
      port: 3000,

      setupMiddlewares: (middlewares, devServer) => {
        const defaultOrganization = {
          id: 1,
          name: 'Default',
          slug: 'default',
          type: 'INTERNAL',
          usersQuantity: 1,
          projectsQuantity: 1,
        };

        devServer.app.get('/api/organizations', (req, res) => {
          res.json([defaultOrganization]);
        });

        devServer.app.post('/api/organizations/searches', (req, res) => {
          res.json([defaultOrganization]);
        });

        devServer.app.get('/api/organizations/1/projects', async (req, res) => {
          try {
            const response = await fetch(`${process.env.PROXY_PATH}api/v1/project/list`, {
              headers: { Authorization: req.headers.authorization || '' },
            });
            const payload = await response.json();
            const content = (payload.content || []).map((project) => ({
              id: project.id,
              projectName: project.projectName,
              projectSlug: project.projectName,
              projectKey: project.projectName,
              projectRole: 'PROJECT_MANAGER',
              entryType: project.entryType,
              organizationId: 1,
            }));
            res.json({ ...payload, content });
          } catch (error) {
            res.status(500).json({ message: error.message });
          }
        });

        devServer.app.post('/api/organizations/1/projects/searches', async (req, res) => {
          try {
            const response = await fetch(`${process.env.PROXY_PATH}api/v1/project/list`, {
              headers: { Authorization: req.headers.authorization || '' },
            });
            const payload = await response.json();
            const content = (payload.content || []).map((project) => ({
              id: project.id,
              projectName: project.projectName,
              projectSlug: project.projectName,
              projectKey: project.projectName,
              projectRole: 'PROJECT_MANAGER',
              entryType: project.entryType,
              organizationId: 1,
            }));
            res.json({ ...payload, content });
          } catch (error) {
            res.status(500).json({ message: error.message });
          }
        });

        return middlewares;
      },
      proxy: [
        {
          context: ['/composite', '/api/', '/uat/'],
          target: process.env.PROXY_PATH,
          changeOrigin: true,
          bypass(req) {
            // eslint-disable-next-line no-console
            console.log(`proxy url: ${req.url}`);
          },
        },
      ],
    },
  };
};
