import { sampleTrip } from "./model/trip";
import { TripMap } from "./map/TripMap";

function App() {
  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-gray-200 px-4 py-2">
        <h1 className="text-lg font-semibold text-gray-900">
          {sampleTrip.title}
        </h1>
      </header>
      <main className="min-h-0 flex-1">
        <TripMap trip={sampleTrip} />
      </main>
    </div>
  );
}

export default App;
