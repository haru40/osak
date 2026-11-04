const PantryStore = (() => {
  const COLUMNS = "id,name";

  function throwIfError(error){
    if(error) throw error;
  }

  async function getAll(userId){
    const {data,error} = await supabaseClient
      .from("pantry_items")
      .select(COLUMNS)
      .eq("user_id",userId)
      .order("created_at",{ascending:true});
    throwIfError(error);
    return data || [];
  }

  async function insert(userId,name){
    const {data,error} = await supabaseClient
      .from("pantry_items")
      .insert({user_id:userId,name})
      .select(COLUMNS)
      .single();
    throwIfError(error);
    return data;
  }

  async function remove(userId,id){
    const {error} = await supabaseClient
      .from("pantry_items")
      .delete()
      .eq("id",id)
      .eq("user_id",userId);
    throwIfError(error);
  }

  return {getAll,insert,remove};
})();
