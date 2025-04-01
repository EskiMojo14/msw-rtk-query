import { configureStore } from "@reduxjs/toolkit";
import type { FetchArgs } from "@reduxjs/toolkit/query";
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query";
import type {
  HttpResponseResolver,
  HttpHandler,
  JsonBodyType,
  DefaultBodyType,
  StrictResponse,
  HttpResponseInit,
} from "msw";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
type Compute<T> = { [K in keyof T]: T[K] } & unknown;
type PickOptional<T, K extends keyof T> = Compute<
  Omit<T, K> & Partial<Pick<T, K>>
>;
type MaybePromise<T> = T | Promise<T>;

export type ExtractParam<
  Path extends string,
  Acc,
> = Path extends `:${infer Param}` ? Record<Param, string> & Acc : Acc;

export type ExtractParams<Path extends string> =
  Path extends `${infer Segment}/${infer Rest}`
    ? ExtractParam<Segment, ExtractParams<Rest>>
    : ExtractParam<Path, {}>;

type HttpMethod = Exclude<keyof typeof http, "all">;

interface EndpointTypes<Path extends string, Result, Body = never> {
  __types?: {
    Path: Path;
    Params: ExtractParams<Path>;
    Result: Result;
    Body: Body;
  };
}

type HttpResolverInfo<
  Path extends string,
  Result extends JsonBodyType,
  Body extends DefaultBodyType = never,
> = Parameters<HttpResponseResolver<ExtractParams<Path>, Body, Result>>[0] & {
  json: (body: Result, init?: HttpResponseInit) => StrictResponse<Result>;
};

type FinalArg<Path extends string, Body> = ExtractParams<Path> &
  ([Body] extends [never] ? { body?: never } : { body: Body });

interface Endpoint<
  Path extends string,
  Result extends JsonBodyType,
  Body extends DefaultBodyType = never,
> extends EndpointTypes<Path, Result, Body> {
  method: HttpMethod;
  path: Path;
  query: (arg: FinalArg<Path, Body>) => FetchArgs;
  mock: (
    resolver: (
      info: HttpResolverInfo<Path, Result, Body>,
    ) => MaybePromise<StrictResponse<Result>>,
  ) => HttpHandler;
}

namespace Endpoint {
  export type Arg<E extends EndpointTypes<string, any, any>> = FinalArg<
    NonNullable<E["__types"]>["Path"],
    NonNullable<E["__types"]>["Body"]
  >;

  export type Result<E extends EndpointTypes<string, any, any>> = NonNullable<
    E["__types"]
  >["Result"];
}

export const applyParams = <Path extends string>(
  path: Path,
  params: ExtractParams<Path>,
) =>
  Object.entries(params).reduce<string>(
    (acc, [key, value]) => acc.replaceAll(`:${key}`, value),
    path,
  );

export const createEndpoint =
  <Result extends JsonBodyType, Body extends DefaultBodyType = never>() =>
  <Path extends string>(
    method: HttpMethod,
    path: Path,
    getFetchArgs?: (
      params: ExtractParams<Path>,
    ) => PickOptional<FetchArgs, "url">,
  ): Endpoint<Path, Result, Body> => ({
    method,
    path,
    query: ({ body, ...params }) => ({
      url: applyParams(path, params as never),
      method,
      body,
      ...getFetchArgs?.(params as never),
    }),
    mock: (resolver) =>
      http[method]<ExtractParams<Path>, Body, Result>(path, (info) =>
        // eslint-disable-next-line @typescript-eslint/unbound-method
        resolver(Object.assign(info, { json: HttpResponse.json })),
      ),
  });

/// example

const server = setupServer();

interface Pokemon {
  name: string;
}

const endpoints = {
  getPokemonByName: createEndpoint<Pokemon>()("get", "/pokemon/:name"),
  updatePokemon: createEndpoint<Pokemon, Partial<Pokemon>>()(
    "patch",
    "/pokemon/:name",
    // customise fetch args
    // url, method and body are automatically added
    (params) => ({
      headers: {
        "X-NAME": params.name,
      },
    }),
  ),
};

const pokemonApi = createApi({
  baseQuery: fetchBaseQuery({ baseUrl: "https://pokeapi.co/api/v2/" }),
  endpoints: (builder) => ({
    getPokemonByName: builder.query<
      Endpoint.Result<typeof endpoints.getPokemonByName>,
      Endpoint.Arg<typeof endpoints.getPokemonByName>
    >({
      query: endpoints.getPokemonByName.query,
    }),
    updatePokemon: builder.mutation<
      Endpoint.Result<typeof endpoints.updatePokemon>,
      Endpoint.Arg<typeof endpoints.updatePokemon>
    >({
      query: endpoints.updatePokemon.query,
    }),
  }),
});

const store = configureStore({
  reducer: {
    [pokemonApi.reducerPath]: pokemonApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(pokemonApi.middleware),
});

void store.dispatch(
  pokemonApi.endpoints.getPokemonByName.initiate({ name: "bulbasaur" }),
);

void store.dispatch(
  pokemonApi.endpoints.updatePokemon.initiate({
    name: "bulbasaur",
    body: { name: "jim" },
  }),
);

server.use(
  endpoints.getPokemonByName.mock(({ json, params }) =>
    json({
      name: params.name,
    }),
  ),
  endpoints.updatePokemon.mock(async ({ json, params, request }) => {
    const patch = await request.json();
    if (Math.random()) {
      // errors must be thrown so they don't affect the return type
      throw HttpResponse.json({ error: "failed" }, { status: 500 });
    }
    // json is required to match the return type
    return json({
      name: params.name,
      ...patch,
    });
  }),
);
