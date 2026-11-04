const IngredientStore = (() => {
  const COLUMNS = "id,user_id,name,qty,unit,days,expiry_date,created_at";

  function toAppIngredient(row){
    return {
      id:row.id,
      name:row.name,
      qty:Number(row.qty),
      unit:row.unit,
      days:row.days==null ? null : Number(row.days),
      expiryDate:row.expiry_date
    };
  }

  function toDatabaseIngredient(userId,item){
    return {
      user_id:userId,
      name:item.name,
      qty:Number(item.qty),
      unit:item.unit,
      days:Number(item.days),
      expiry_date:item.expiryDate || null
    };
  }

  function throwIfError(error){
    if(error) throw error;
  }

  async function getAll(userId){
    const {data,error} = await supabaseClient
      .from("ingredients")
      .select(COLUMNS)
      .eq("user_id",userId)
      .order("created_at",{ascending:true});
    throwIfError(error);
    return (data || []).map(toAppIngredient);
  }

  async function insert(userId,item){
    const {data,error} = await supabaseClient
      .from("ingredients")
      .insert(toDatabaseIngredient(userId,item))
      .select(COLUMNS)
      .single();
    throwIfError(error);
    return toAppIngredient(data);
  }

  async function insertMany(userId,items){
    if(!items.length) return [];
    const rows = items.map(item=>toDatabaseIngredient(userId,item));
    const {data,error} = await supabaseClient
      .from("ingredients")
      .insert(rows)
      .select(COLUMNS);
    throwIfError(error);
    return (data || []).map(toAppIngredient);
  }

  async function update(userId,item){
    const {data,error} = await supabaseClient
      .from("ingredients")
      .update({
        name:item.name,
        qty:Number(item.qty),
        unit:item.unit,
        days:Number(item.days),
        expiry_date:item.expiryDate || null
      })
      .eq("id",item.id)
      .eq("user_id",userId)
      .select(COLUMNS)
      .single();
    throwIfError(error);
    return toAppIngredient(data);
  }

  async function updateMany(userId,items){
    const persisted = await Promise.all(items.filter(item=>item.id!=null).map(item=>update(userId,item)));
    return persisted;
  }

  async function remove(userId,id){
    const {error} = await supabaseClient
      .from("ingredients")
      .delete()
      .eq("id",id)
      .eq("user_id",userId);
    throwIfError(error);
  }

  async function removeMany(userId,ids){
    const filteredIds = ids.filter(id=>id!=null);
    if(!filteredIds.length) return;
    const {error} = await supabaseClient
      .from("ingredients")
      .delete()
      .eq("user_id",userId)
      .in("id",filteredIds);
    throwIfError(error);
  }

  async function removeAll(userId){
    const {error} = await supabaseClient
      .from("ingredients")
      .delete()
      .eq("user_id",userId);
    throwIfError(error);
  }

  async function syncChanges(userId,beforeItems,afterItems){
    const remainingIds = new Set(afterItems.map(item=>item.id).filter(id=>id!=null));
    const removedIds = beforeItems
      .map(item=>item.id)
      .filter(id=>id!=null && !remainingIds.has(id));

    await removeMany(userId,removedIds);
    await updateMany(userId,afterItems);
  }

  return {getAll,insert,insertMany,update,updateMany,remove,removeMany,removeAll,syncChanges};
})();
